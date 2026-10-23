/**
 * 后备库（reserve vault）：技能的「长期停放区」。
 *
 * 跟回收站的区别：
 * - 回收站 = 临时撤销（本插件自管，带时间戳命名）
 * - 后备库 = 你自己的目录，删除时选「存后备」放进来，以后一键装回
 *
 * 约束（都是踩过的坑）：
 * - 后备库必须在所有技能根之外 —— 放进去的东西不会被当成已装技能扫到。
 * - 目录结构就是分类：`<后备库>/<分类>/<技能名>/SKILL.md`，直接放根下则归「未分类」。
 * - 动了目录就同步写 `_后备库索引.md`（本插件自己的索引，不碰用户其它清单）。
 * - 装回 = 复制，不删后备库的那一份（可反复装）；目标已存在则拒绝，绝不覆盖。
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'

export const INDEX_FILE = '_后备库索引.md'
export const UNCATEGORIZED = '未分类'

function isInside(child, parent) {
  const c = resolve(child)
  const p = resolve(parent)
  return c === p || c.startsWith(p + sep)
}

/** 后备库不能落在任何技能根里，否则会被扫成"已安装"。 */
export function assertVaultOutsideSkills(vaultRoot, skillRoots = []) {
  const root = resolve(vaultRoot)
  for (const skillRoot of skillRoots) {
    if (isInside(root, skillRoot)) {
      throw new Error(`拒绝：后备库不能放在技能根内（${skillRoot}）`)
    }
  }
  return root
}

function hasSkill(dir) {
  return existsSync(join(dir, 'SKILL.md')) || existsSync(join(dir, 'SKILL.md.disabled'))
}

function frontmatterOf(dir) {
  for (const file of ['SKILL.md', 'SKILL.md.disabled']) {
    const full = join(dir, file)
    if (!existsSync(full)) continue
    try {
      const text = readFileSync(full, 'utf8').replace(/^\uFEFF/, '')
      const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
      const body = block ? text.slice(block[0].length) : text
      const meta = block ? block[1] : ''
      const name = /^name:\s*(.+)$/m.exec(meta)
      const desc = /^description:\s*(.+)$/m.exec(meta)
      const firstLine = body.split(/\r?\n/).map((l) => l.trim()).find((l) => l !== '' && !l.startsWith('#')) || ''
      return {
        name: name ? name[1].trim().replace(/^["']|["']$/g, '') : '',
        description: desc ? desc[1].trim().replace(/^["']|["']$/g, '') : firstLine,
      }
    } catch {
      return { name: '', description: '' }
    }
  }
  return { name: '', description: '' }
}

function sizeOf(dir) {
  let bytes = 0
  let files = 0
  const walk = (current) => {
    let items = []
    try { items = readdirSync(current, { withFileTypes: true }) } catch { return }
    for (const item of items) {
      const full = join(current, item.name)
      if (item.isDirectory()) walk(full)
      else if (item.isFile()) {
        files += 1
        try { bytes += statSync(full).size } catch { /* 读不到不计 */ }
      }
    }
  }
  walk(dir)
  return { bytes, files }
}

/** 读 `_后备库索引.md` 的表格行，给条目补来源/体积/用途。 */
function readIndex(vaultRoot) {
  const map = new Map()
  const file = join(vaultRoot, INDEX_FILE)
  if (!existsSync(file)) return map
  let text = ''
  try { text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '') } catch { return map }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|')) continue
    if (/^\|\s*-+/.test(trimmed) || /^\|\s*名字\s*\|/.test(trimmed)) continue
    const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
    if (cells.length < 2 || cells[0] === '') continue
    map.set(cells[0], { description: cells[1] || '', source: cells[2] || '', use: cells[4] || '' })
  }
  return map
}

function entryOf(dir, category, indexMap) {
  const meta = frontmatterOf(dir)
  const name = meta.name || basename(dir)
  const extra = indexMap.get(name) || {}
  const { bytes, files } = sizeOf(dir)
  return {
    id: category === '' ? basename(dir) : `${category}/${basename(dir)}`,
    dirName: basename(dir),
    name,
    category,
    description: extra.description || meta.description || '',
    source: extra.source || '',
    bytes,
    files,
    path: dir,
  }
}

/** 列出后备库：分类 = 顶层不含 SKILL.md 的目录；根下散放算「未分类」。 */
export function listVault(input = {}) {
  const vaultRoot = resolve(input.vaultRoot)
  if (!existsSync(vaultRoot)) {
    return { ok: true, vaultRoot, exists: false, categories: [], entries: [], total: 0, note: '后备库还没建立（还没往里存过技能）' }
  }
  const indexMap = readIndex(vaultRoot)
  const entries = []
  for (const item of readdirSync(vaultRoot, { withFileTypes: true })) {
    if (!item.isDirectory() || item.name.startsWith('_')) continue
    const dir = join(vaultRoot, item.name)
    if (hasSkill(dir)) {
      entries.push(entryOf(dir, '', indexMap))
      continue
    }
    for (const child of readdirSync(dir, { withFileTypes: true })) {
      if (!child.isDirectory()) continue
      const sub = join(dir, child.name)
      if (hasSkill(sub)) entries.push(entryOf(sub, item.name, indexMap))
    }
  }
  const categories = [...new Set(entries.map((e) => e.category).filter((c) => c !== ''))].sort((a, b) => a.localeCompare(b, 'zh'))
  if (entries.some((e) => e.category === '')) categories.push(UNCATEGORIZED)
  entries.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  return { ok: true, vaultRoot, exists: true, categories, entries, total: entries.length }
}

function appendIndexRow(vaultRoot, entry) {
  const file = join(vaultRoot, INDEX_FILE)
  const header = '| 名字 | 一句话能力 | 来源 | 体积 | 适用会话 |\n| --- | --- | --- | --- | --- |\n'
  let text = ''
  if (existsSync(file)) {
    text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
  } else {
    text = `# 后备库索引\n\n> 由技能面板维护；从面板「后备库」页删除技能时会自动追加一行。\n\n${header}`
  }
  if (new RegExp(`^\\|\\s*${entry.name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*\\|`, 'm').test(text)) return
  if (!text.endsWith('\n')) text += '\n'
  const size = `${(entry.bytes / 1024).toFixed(1)} KB`
  text += `| ${entry.name} | ${entry.description.replace(/\|/g, '\\|')} |  | ${size} |  |\n`
  writeFileSync(file, text, 'utf8')
}

/** 删除技能时选「存后备」：整目录移进后备库（先复制成功，再删原件）。 */
export function moveToVault(input = {}) {
  const filePath = typeof input.filePath === 'string' ? input.filePath : ''
  if (filePath === '') throw new Error('没有指定要移动的技能')
  const source = dirname(resolve(filePath))
  if (!existsSync(source) || !hasSkill(source)) throw new Error(`拒绝：${source} 不像一个技能目录`)
  const vaultRoot = resolve(input.vaultRoot)
  const category = typeof input.category === 'string' ? input.category.trim().replace(/[\\/:*?"<>|]/g, '') : ''
  const parent = category === '' ? vaultRoot : join(vaultRoot, category)
  mkdirSync(parent, { recursive: true })

  const base = basename(source)
  let target = join(parent, base)
  let n = 2
  while (existsSync(target)) {
    target = join(parent, `${base}-${n}`)
    n += 1
  }
  cpSync(source, target, { recursive: true, errorOnExist: true })
  const entry = entryOf(target, category, new Map())
  appendIndexRow(vaultRoot, entry)
  rmSync(source, { recursive: true, force: true })
  return { ok: true, name: entry.name, target, category }
}

/** 从后备库装回技能根：复制，不删后备库；同名已存在则拒绝。 */
export function installFromVault(input = {}) {
  const vaultRoot = resolve(input.vaultRoot)
  const id = typeof input.id === 'string' ? input.id.trim() : ''
  if (id === '' || id.includes('..')) throw new Error('拒绝：非法的后备库条目')
  const source = resolve(join(vaultRoot, ...id.split('/')))
  if (!isInside(source, vaultRoot) || source === vaultRoot) throw new Error('拒绝：条目不在后备库内')
  if (!hasSkill(source)) throw new Error(`后备库里没有这个技能：${id}`)
  const targetRoot = resolve(input.targetRoot)
  const target = join(targetRoot, basename(source))
  if (existsSync(target)) throw new Error(`拒绝：${basename(source)} 已经装在技能根里了，先改名或删掉再装`)
  mkdirSync(targetRoot, { recursive: true })
  cpSync(source, target, { recursive: true, errorOnExist: true })
  return { ok: true, name: basename(source), installed: target }
}
