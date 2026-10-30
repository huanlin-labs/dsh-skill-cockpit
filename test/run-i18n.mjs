/**
 * 文案字典自测：中英两份 key 必须一一对应，占位符集合必须一致，值不能为空。
 *
 * 为什么单独一套：2026-10-27 真犯过一次——zh 字典漏了 gloss.* 五个键，
 * 界面上直接显示原始 key。这个套件把“漏翻译”变成提交前就能抓到的事。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let pass = 0
let total = 0
const check = (label, ok, detail) => {
  total += 1
  if (ok) pass += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ← ' + String(detail)}`)
}

const clientFile = process.env.COCKPIT_CLIENT || join(import.meta.dirname, '..', 'lib', 'client.js')
const source = readFileSync(clientFile, 'utf8')
const start = source.indexOf('const MESSAGES = {')
if (start < 0) {
  console.log('FAIL  找不到 MESSAGES 字典')
  process.exit(1)
}
let i = source.indexOf('{', start)
let depth = 0
let end = -1
for (; i < source.length; i += 1) {
  const ch = source[i]
  if (ch === '{') depth += 1
  else if (ch === '}') {
    depth -= 1
    if (depth === 0) {
      end = i + 1
      break
    }
  }
}
if (end < 0) {
  console.log('FAIL  MESSAGES 字典括号不闭合')
  process.exit(1)
}
const literal = source.slice(source.indexOf('{', start), end)
let messages
try {
  messages = new Function(`return (${literal})`)()
} catch (error) {
  console.log(`FAIL  MESSAGES 无法求值：${error.message}`)
  process.exit(1)
}

const zh = messages.zh || {}
const en = messages.en || {}
const zhKeys = Object.keys(zh).sort()
const enKeys = Object.keys(en).sort()
console.log(`  字典规模：zh ${Object.keys(zh).length} 条 / en ${Object.keys(en).length} 条`)
check('zh / en 两份字典都存在', Object.keys(zh).length > 0 && Object.keys(en).length > 0, `${zhKeys.length}/${enKeys.length}`)
check('两份字典 key 数量一致', zhKeys.length === enKeys.length, `zh=${zhKeys.length} en=${enKeys.length}`)

const missingEn = zhKeys.filter((k) => !(k in en))
const missingZh = enKeys.filter((k) => !(k in zh))
check('zh 有、en 缺的键为 0', missingEn.length === 0, missingEn.join(', '))
check('en 有、zh 缺的键为 0', missingZh.length === 0, missingZh.join(', '))

const empty = zhKeys.filter((k) => typeof zh[k] !== 'string' || zh[k].trim() === '')
check('zh 没有空文案', empty.length === 0, empty.join(', '))
const emptyEn = enKeys.filter((k) => typeof en[k] !== 'string' || en[k].trim() === '')
check('en 没有空文案', emptyEn.length === 0, emptyEn.join(', '))

const placeholders = (text) => new Set([...String(text).matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]))
const mismatch = []
for (const key of zhKeys) {
  if (!(key in en)) continue
  const a = [...placeholders(zh[key])].sort().join(',')
  const b = [...placeholders(en[key])].sort().join(',')
  if (a !== b) mismatch.push(`${key}: zh={${a}} en={${b}}`)
}
check('同一 key 的占位符集合一致', mismatch.length === 0, mismatch.slice(0, 5).join(' | '))

console.log(`\n=== 文案字典自测：${pass}/${total} 通过 ===`)
process.exit(pass === total ? 0 : 1)
