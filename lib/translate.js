import tls from 'node:tls'
import http from 'node:http'
import { execFileSync } from 'node:child_process'

/**
 * 本机系统代理（Clash / 公司代理等）。
 *
 * 为什么要它：宿主进程里的 fetch 走 Node 自己的网络栈，**不认 Windows 系统代理**，
 * 开着代理的机器上直连会超时；而用户在浏览器里一切正常。所以这里读一次系统
 * 代理并自己建 CONNECT 隧道。
 *
 * 顺序：环境变量 → Windows 注册表（ProxyEnable=1）→ 无代理。
 * @returns {{host:string, port:number}|null}
 */
export function detectProxy() {
  const env = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || ''
  if (env) {
    try {
      const url = new URL(env.includes('://') ? env : `http://${env}`)
      if (url.hostname) return { host: url.hostname, port: Number(url.port || 80) }
    } catch {
      /* 环境变量写坏就继续找 */
    }
  }
  if (process.platform !== 'win32') return null
  try {
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
    const raw = execFileSync('reg', ['query', key], { encoding: 'utf8', timeout: 3000, windowsHide: true })
    if (!/ProxyEnable\s+REG_DWORD\s+0x1/i.test(raw)) return null
    const line = raw.split(/\r?\n/).find((l) => /ProxyServer\s+REG_SZ/i.test(l))
    if (!line) return null
    const value = line.split(/REG_SZ\s+/)[1]?.trim() ?? ''
    const map = Object.fromEntries(
      value
        .split(';')
        .map((part) => part.split('='))
        .filter((pair) => pair.length === 2)
        .map(([k, v]) => [k.trim().toLowerCase(), v.trim()]),
    )
    const chosen = map.https || map.http || value.replace(/^.*=/, '')
    const [host, port] = chosen.split(':')
    if (!host || !port) return null
    return { host, port: Number(port) }
  } catch {
    return null
  }
}

function connectViaProxy(proxy, host, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: proxy.host,
      port: proxy.port,
      method: 'CONNECT',
      path: `${host}:443`,
      headers: { host: `${host}:443` },
      timeout: timeoutMs,
    })
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy()
        reject(new Error(`proxy CONNECT ${res.statusCode}`))
        return
      }
      const secure = tls.connect({ socket, servername: host })
      secure.once('secureConnect', () => resolve(secure))
      secure.once('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error('proxy timeout')))
    req.on('error', reject)
    req.end()
  })
}

function connectDirect(host, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port: 443, servername: host })
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error('timeout')))
    socket.once('secureConnect', () => resolve(socket))
    socket.once('error', reject)
  })
}

function dechunk(raw) {
  let out = ''
  let rest = raw
  for (;;) {
    const nl = rest.indexOf('\r\n')
    if (nl < 0) break
    const size = parseInt(rest.slice(0, nl), 16)
    if (!Number.isFinite(size) || size <= 0) break
    out += rest.slice(nl + 2, nl + 2 + size)
    rest = rest.slice(nl + 2 + size + 2)
  }
  return out
}

function requestOverSocket(socket, host, path, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0)
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('timeout'))
    }, timeoutMs)
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      const headEnd = buffer.indexOf('\r\n\r\n')
      if (headEnd < 0) return
      const head = buffer.slice(0, headEnd).toString('latin1')
      const status = Number((head.match(/^HTTP\/1\.[01]\s+(\d{3})/) || [])[1] || 0)
      const headers = head.toLowerCase()
      const bodyBuf = buffer.slice(headEnd + 4)
      if (headers.includes('transfer-encoding: chunked')) {
        if (!bodyBuf.toString('latin1').includes('\r\n0\r\n')) return
      } else if (headers.includes('content-length:')) {
        const length = Number((headers.match(/content-length:\s*(\d+)/) || [])[1] || 0)
        if (bodyBuf.length < length) return
      } else {
        return
      }
      clearTimeout(timer)
      socket.end()
      if (status !== 200) {
        reject(new Error(`http ${status}`))
        return
      }
      let text = bodyBuf.toString('utf8')
      if (headers.includes('transfer-encoding: chunked')) text = dechunk(text)
      try {
        resolve(JSON.parse(text))
      } catch (error) {
        reject(new Error(`bad json: ${error.message}`))
      }
    })
    socket.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    socket.write(
      `GET ${path} HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: Mozilla/5.0\r\nAccept: application/json\r\nConnection: close\r\n\r\n`,
      'latin1',
    )
  })
}

async function getJson(host, path, { proxy, timeoutMs }) {
  const socket = proxy ? await connectViaProxy(proxy, host, timeoutMs) : await connectDirect(host, timeoutMs)
  try {
    return await requestOverSocket(socket, host, path, timeoutMs)
  } finally {
    socket.destroy?.()
  }
}

/** MyMemory：匿名免费（每天有额度），国内可达，质量够一行描述。 */
async function viaMyMemory(text, targetLanguage, options) {
  const pair = `en|${targetLanguage}`
  const path = `/get?q=${encodeURIComponent(text.slice(0, 500))}&langpair=${encodeURIComponent(pair)}`
  const data = await getJson('api.mymemory.translated.net', path, options)
  const out = data?.responseData?.translatedText
  if (!out || !String(out).trim()) throw new Error('MyMemory 空结果')
  if (/MYMEMORY WARNING|QUOTA|INVALID/i.test(String(out))) throw new Error(String(out).slice(0, 60))
  return String(out)
}

/** Google 匿名端点（免 key，但可能 429）。 */
async function viaGoogle(text, targetLanguage, options) {
  const path = `/translate_a/single?client=gtx&sl=auto&dt=t&q=${encodeURIComponent(text.slice(0, 1800))}&tl=${encodeURIComponent(targetLanguage)}`
  const data = await getJson('translate.googleapis.com', path, options)
  const out = (data?.[0] ?? []).map((seg) => (seg && seg[0]) || '').join('')
  if (!out.trim()) throw new Error('Google 空结果')
  return out
}

/**
 * 把一段英文技能描述翻成中文。两个免费源依次尝试，都失败才抛错。
 * @param text 原文
 * @param targetLanguage 目标语言，默认 zh-CN
 * @param proxy 可注入代理（测试用）；缺省自动探测系统代理
 * @param timeoutMs 单条超时
 */
export async function translateText(text, { targetLanguage = 'zh-CN', proxy, timeoutMs = 12000 } = {}) {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return ''
  const chosen = proxy === undefined ? detectProxy() : proxy
  const options = { proxy: chosen, timeoutMs }
  const failures = []
  for (const attempt of [viaMyMemory, viaGoogle]) {
    try {
      return await attempt(trimmed, targetLanguage, options)
    } catch (error) {
      failures.push(`${attempt.name}: ${error?.message ?? error}`)
    }
  }
  throw new Error(failures.join(' / '))
}
