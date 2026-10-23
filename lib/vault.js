/**
 * 后备库（reserve list）—— 一份「名字 + 从哪下」的名单，不是技能目录。
 *
 * 语义（户主 2026-10-23 定稿）：
 * - 「存进后备库」= 跟普通删除一模一样（整目录复制进回收站后删除），**只多写一行名单**；
 * - 名单里不放技能文件，只放：名字 / 一句话能力 / 来源（从哪下）/ 体积 / 备注；
 * - 「恢复」= 把这条装回来：来源是本机目录就复制回来；来源不是本机目录（仓库名、网址）时
 *   明确拒绝 —— 面板不联网，也不猜下载地址。
 *
 * 写操作只有两处：addToVault 追加一行；restoreFromVault 复制回技能根。
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { deleteSkill } from './manage-write.js'

export const LIST_FILE = '后备库.md'
export const LEGACY_INDEX_FILE = '_后备库索引.md'
export const TABLE_HEADER =
  '| 名字 | 一句话能力 | 来源（从哪下） | 体积 | 备注 |\n| --- | --- | --- | --- | --- |\n'

function isInside(child, parent) {
  const c = resolve(child)
  const p = resolve(parent)
  return c === p || c.startsWith(p + sep)
}

/** 名单文件必须放在技能根之外。 */
export function assertListOutsideSkills(listPath, skillRoots = []) {
  const target = resolve(listPath)
  for (const skillRoot of skillRoots) {
    if (isInside(target, skillRoot)) {
      throw new Error(`拒绝：后备名单不能放在技能根内（${skillRoot}）`)
    }
  }
  return target
}

function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
}

function isSeparator(cells) {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.replace(/\s/g, '')))
}

function unquote(text) {
  return text.replace(/^`|`$/g, '').replace(/[`*]/g, '').trim()
}

/** 读名单：标题只用于分组展示，条目本身是平的。 */
export function listVault(input = {}) {
  const listPath = resolve(input.listPath)
  if (!existsSync(listPath)) {
    return { ok: true, listPath, exists: false, groups: [], entries: [], total: 0 }
  }
  let text = ''
  try {
    text = readFileSync(listPath, 'utf8').replace(/^\uFEFF/, '')
  } catch (error) {
    return { ok: false, listPath, exists: false, groups: [], entries: [], total: 0, error: String(error?.message ?? error) }
  }
  const entries = []
  const groups = []
  const seen = new Set()
  let current = null
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('#')) {
      const title = trimmed.replace(/^#+\s*/, '').trim()
      current = title === '' ? null : { title, count: 0 }
      if (current) groups.push(current)
      continue
    }
    if (!trimmed.startsWith('|')) continue
    const cells = splitRow(trimmed)
    if (cells.length < 2 || isSeparator(cells) || cells[0] === '名字') continue
    const name = unquote(cells[0])
    if (name === '' || seen.has(name)) continue
    seen.add(name)
    entries.push({
      name,
      description: cells[1] || '',
      source: cells[2] || '',
      size: cells[3] || '',
      note: cells[4] || '',
    })
    if (current) current.count += 1
  }
  return {
    ok: true,
    listPath,
    exists: true,
    groups: groups.filter((g) => g.count > 0),
    entries,
    total: entries.length,
  }
}

/** 从 SKILL.md frontmatter 取一个字段（取不到就空串）。 */
function frontmatterField(dir, key) {
  for (const file of ['SKILL.md', 'SKILL.md.disabled']) {
    const full = join(dir, file)
    if (!existsSync(full)) continue
    try {
      const text = readFileSync(full, 'utf8').replace(/^\uFEFF/, '')
      const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
      if (!block) continue
      const m = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(block[1])
      if (m && m[1].trim() !== '') return m[1].trim().replace(/^["']|["']$/g, '')
    } catch {
      /* 读不到就当没有 */
    }
  }
  return ''
}

/** SKILL.md 里若有 source/repository/homepage，拿来当「从哪下」。 */
function frontmatterSource(dir) {
  for (const key of ['source', 'repository', 'repo', 'homepage', 'url', 'origin']) {
    const value = frontmatterField(dir, key)
    if (value !== '') return value
  }
  return ''
}

function sizeOf(dir) {
  let bytes = 0
  const walk = (current) => {
    let items = []
    try {
      items = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const item of items) {
      const full = join(current, item.name)
      if (item.isDirectory()) walk(full)
      else if (item.isFile()) {
        try {
          bytes += statSync(full).size
        } catch {
          /* 读不到不计 */
        }
      }
    }
  }
  walk(dir)
  return bytes
}

function appendRow(listPath, entry) {
  mkdirSync(dirname(listPath), { recursive: true })
  let text = ''
  if (existsSync(listPath)) {
    text = readFileSync(listPath, 'utf8').replace(/^\uFEFF/, '')
  } else {
    text = `# 后备库名单\n\n> 由技能面板维护。放进来 = 本地已删除；恢复 = 按「来源」装回来。\n\n${TABLE_HEADER}`
  }
  const escaped = entry.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (new RegExp(`^\\|\\s*\`?${escaped}\`?\\s*\\|`, 'm').test(text)) return false
  if (!text.endsWith('\n')) text += '\n'
  const size = entry.bytes > 0 ? `${(entry.bytes / 1024).toFixed(1)} KB` : ''
  const cell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
  text += `| ${cell(entry.name)} | ${cell(entry.description)} | ${cell(entry.source)} | ${size} | ${cell(entry.note)} |\n`
  writeFileSync(listPath, text, 'utf8')
  return true
}

/**
 * 「存进后备库」：完全走普通删除（复制进回收站 + 删原件），成功后再追加一行名单。
 * 删除失败就不写名单；名单写失败会抛错，但原件已在回收站，可还原。
 */
export function addToVault(input = {}) {
  const filePath = typeof input.filePath === 'string' ? input.filePath : ''
  if (filePath === '') throw new Error('没有指定要移动的技能')
  const source = dirname(resolve(filePath))
  const name = basename(source)
  const description =
    typeof input.description === 'string' && input.description.trim() !== ''
      ? input.description.trim()
      : frontmatterField(source, 'description')
  const sourceHint =
    typeof input.source === 'string' && input.source.trim() !== '' ? input.source.trim() : frontmatterSource(source)
  const bytes = sizeOf(source)
  const deleted = deleteSkill({ filePath, root: input.root, trashRoot: input.trashRoot })
  const recorded = appendRow(resolve(input.listPath), { name, description, source: sourceHint, bytes, note: '' })
  return { ok: true, name, deleted: deleted.trashPath, recorded }
}

/** 从名单恢复：来源必须是本机目录且含 SKILL.md；否则拒绝（面板不联网）。 */
export function restoreFromVault(input = {}) {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (name === '') throw new Error('没有指定要恢复的技能')
  const listed = listVault({ listPath: input.listPath })
  const entry = listed.entries.find((e) => e.name === name)
  if (!entry) throw new Error(`名单里没有 ${name}`)
  const source = entry.source.trim()
  if (source === '' || !isAbsolute(source)) {
    throw new Error(`拒绝：${name} 的来源不是本机目录（${source || '空'}）—— 面板不联网，请按来源自行下载后再装`)
  }
  if (!existsSync(join(source, 'SKILL.md')) && !existsSync(join(source, 'SKILL.md.disabled'))) {
    throw new Error(`拒绝：来源目录里没有 SKILL.md（${source}）`)
  }
  const targetRoot = resolve(input.targetRoot)
  const target = join(targetRoot, name)
  if (existsSync(target)) throw new Error(`拒绝：${name} 已经装在技能根里了`)
  mkdirSync(targetRoot, { recursive: true })
  cpSync(source, target, { recursive: true, errorOnExist: true })
  return { ok: true, name, installed: target, source }
}
