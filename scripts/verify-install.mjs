#!/usr/bin/env node
/**
 * verify:install —— 证明「发出去的包」能装、能跑，而不是「源码能跑」。
 *
 * 顺序（任何一步不符就以非 0 退出）：
 *   1. npm pack 出 tarball
 *   2. 装进一个空的临时目录
 *   3. 装上的版本号 = 仓库 package.json 的版本
 *   4. 用**装上去的那份** lib/index.js 启动宿主半：能注册路由
 *   5. 用装机副本的 /ping 读回版本号（入口真的能执行，不只是文件在）
 *   6. 状态目录能被 SKILL_COCKPIT_HOME 重定向（测试不污染真实 ~/.dsh）
 */
import { mkdirSync, readFileSync, readdirSync, existsSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

let pass = 0
let failed = 0
const check = (label, ok, detail = '') => {
  if (ok) {
    pass += 1
    console.log(`PASS  ${label}`)
  } else {
    failed += 1
    console.log(`FAIL  ${label}${detail === '' ? '' : '  ← ' + String(detail)}`)
  }
}

const work = mkdtempSync(join(tmpdir(), 'skill-cockpit-verify-'))
// Windows 上 npm 是 .cmd，spawn 必须走 shell，否则 EINVAL 静默失败。
const run = (args, options) => spawnSync(npm, args, { encoding: 'utf8', shell: process.platform === 'win32', ...options })

try {
  // 1 · pack
  const packed = run(['pack', '--pack-destination', work], { cwd: root })
  // 不解析 npm 的 JSON（新版会往 stdout 混 notice）；直接看目录里生成的 tgz。
  const tgz = readdirSync(work).filter((name) => name.endsWith('.tgz'))
  const tarball = tgz.length === 1 ? join(work, tgz[0]) : ''
  check('npm pack 成功且拿到 tarball', tarball !== '' && existsSync(tarball), (packed.stderr || '').slice(-300))
  if (tarball === '') throw new Error('没有生成 tarball，中止（否则会误装 registry 上的旧版）')

  // 2 · 装进空目录
  const app = join(work, 'app')
  mkdirSync(app, { recursive: true })
  const installedRun = run(['install', '--no-audit', '--no-fund', '--prefix', app, tarball], { cwd: app })
  const installed = join(app, 'node_modules', pkg.name)
  check('装进空目录后包目录存在', existsSync(installed), (installedRun.stderr || '').slice(-300))

  // 3 · 版本一致
  const installedPkg = existsSync(join(installed, 'package.json'))
    ? JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'))
    : {}
  check('装机副本版本 = package.json', installedPkg.version === pkg.version, `${installedPkg.version} ≠ ${pkg.version}`)
  check('装机副本带客户端半', existsSync(join(installed, 'lib', 'client.js')))

  // 4 · 用装机副本启动宿主半
  const stateHome = join(work, 'state')
  process.env.SKILL_COCKPIT_HOME = stateHome
  const routes = []
  const host = { register(route) { routes.push(route); return () => {} } }
  const ctx = {
    get: (name) => (name === 'webServer' ? host : undefined),
    inject: (_deps, cb) => cb(ctx),
    effect: (fn) => { if (typeof fn === 'function') fn(); return () => {} },
    on: () => () => {},
    tools: { register: () => () => {} },
  }
  let bootError = ''
  try {
    const mod = await import(pathToFileURL(join(installed, 'lib', 'index.js')).href)
    await mod.apply(ctx, {})
  } catch (error) {
    bootError = error?.message || String(error)
  }
  check('装机副本能启动并注册路由', routes.length > 0, bootError || `routes=${routes.length}`)
  const paths = routes.map((r) => r.path)
  check(
    '路由含 ping / gloss / gloss/translate',
    paths.some((p) => p.endsWith('/ping')) &&
      paths.some((p) => p.endsWith('/gloss')) &&
      paths.some((p) => p.endsWith('/gloss/translate')),
    paths.slice(0, 4).join(', '),
  )

  // 5 · 用装机副本的 /ping 读回版本
  const pingRoute = routes.find((r) => r.path.endsWith('/ping'))
  let ping = {}
  if (pingRoute) {
    const res = { status: 0, body: '', writeHead(status) { this.status = status }, end(chunk) { if (chunk !== undefined) this.body += chunk } }
    const req = {
      url: pingRoute.path,
      method: 'GET',
      headers: { host: '127.0.0.1:1', origin: 'http://127.0.0.1:1' },
      socket: { remoteAddress: '127.0.0.1', remotePort: 1 },
      [Symbol.asyncIterator]: async function* () {},
    }
    await pingRoute.handler(req, res)
    try {
      ping = JSON.parse(res.body || '{}')
    } catch {
      ping = {}
    }
  }
  check(`装机副本 /ping 返回 ${pkg.name} ${pkg.version}`, ping.ok === true && ping.version === pkg.version, JSON.stringify(ping).slice(0, 160))

  // 5.5 · 用装机副本的 bin 跑 --version（证明发布物里的入口真能跑）
  const doctorBin = join(installed, 'bin', 'cockpit-doctor.mjs')
  const versionRun = spawnSync(process.execPath, [doctorBin, '--version'], { encoding: 'utf8' })
  check(
    '装机副本 doctor --version 输出包名+版本',
    versionRun.status === 0 && String(versionRun.stdout).trim() === `${pkg.name} ${pkg.version}`,
    String(versionRun.stdout || versionRun.stderr).slice(0, 160),
  )

  // 5.6 · 装机副本的 doctor：空 home 先报"需要修" → --fix → 复检 ok → 再 --fix 仍 ok（幂等）
  const doctorHome = join(work, 'doctor-home')
  mkdirSync(doctorHome, { recursive: true })
  const readDoctor = (args) => {
    const run = spawnSync(process.execPath, [doctorBin, '--json', '--home', doctorHome, ...args], { encoding: 'utf8' })
    let payload = {}
    try {
      payload = JSON.parse(String(run.stdout))
    } catch {
      payload = {}
    }
    return { run, payload }
  }

  const before = readDoctor([])
  check(
    '空 home 上 doctor 报"需要修"（不是刚装好就全绿）',
    before.run.status === 1 && before.payload.ok === false,
    String(before.run.stdout).slice(0, 200),
  )

  const fixRun = readDoctor(['--fix'])
  check('装机副本 doctor --home --fix 退出码 0', fixRun.run.status === 0 && fixRun.payload.ok === true, String(fixRun.run.stdout).slice(0, 200))

  const afterFix = readDoctor([])
  check('--fix 后复检 doctor 全绿', afterFix.run.status === 0 && afterFix.payload.ok === true, String(afterFix.run.stdout).slice(0, 200))

  const fixAgain = readDoctor(['--fix'])
  check('再跑一次 --fix 仍全绿（幂等）', fixAgain.run.status === 0 && fixAgain.payload.ok === true, String(fixAgain.run.stdout).slice(0, 200))

  // 6 · 状态目录可重定向
  const stateMod = await import(pathToFileURL(join(installed, 'lib', 'state.js')).href)
  check('状态目录跟随 SKILL_COCKPIT_HOME', stateMod.stateDir() === stateHome, stateMod.stateDir())
} finally {
  delete process.env.SKILL_COCKPIT_HOME
  rmSync(work, { recursive: true, force: true })
}

console.log(`\n${failed === 0 ? 'verify:install 全绿' : 'verify:install 失败'} · ${pass} 通过 / ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
