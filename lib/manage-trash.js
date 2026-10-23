import { homedir } from 'node:os'
/**
 * 回收站层：列出 / 还原 / 彻底删除。
 *
 * 删除动作在 manage-write.js 里已经把整个技能目录复制到 <trashRoot>/<stamp>-<name>。
 * 这里只负责读那一份副本，所以任何还原都不依赖原目录还在不在。
 *
 * 约束：
 * - 只认 trashRoot 的直接子目录，id 里出现分隔符一律拒绝（防穿越）。
 * - 还原不覆盖同名技能（先让你改名或删掉再还原）。
 * - 彻底删除只删回收站里的那一份，绝不碰技能根。
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const DEFAULT_TRASH_ROOT = join(homedir(), '.dsh', 'skill-panel', 'trash')

function rootOf(input = {}) {
  const raw = typeof input.trashRoot === 'string' && input.trashRoot.trim() !== ''
    ? input.trashRoot.trim()
    : DEFAULT_TRASH_ROOT
  return resolve(raw)
}

/** id 只允许是回收站里的一个目录名：不许分隔符、不许 . / .. */
function entryDir(trashRoot, id) {
  const text = typeof id === 'string' ? id.trim() : ''
  if (text === '') throw new Error('没有指定回收站条目')
  if (text.includes('/') || text.includes('\\') || text === '.' || text === '..') {
    throw new Error(`拒绝：非法的回收站条目：${text}`)
  }
  const dir = join(trashRoot, text)
  if (resolve(dir) !== dir) throw new Error(`拒绝：条目不在回收站内：${text}`)
  if (!existsSync(dir)) throw new Error(`回收站里没有这一条：${text}`)
  return dir
}

function readName(dir, fallback) {
  const file = join(dir, 'SKILL.md')
  try {
    if (!existsSync(file)) return fallback
    const text = readFileSync(file, 'utf8')
    const hit = /^name:\s*(.+)$/m.exec(text)
    const name = hit ? hit[1].trim().replace(/^["']|["']$/g, '') : ''
    return name !== '' ? name : fallback
  } catch {
    return fallback
  }
}

function sizeOf(dir) {
  let bytes = 0
  let files = 0
  const walk = (current) => {
    for (const item of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, item.name)
      if (item.isDirectory()) walk(full)
      else if (item.isFile()) {
        files += 1
        try { bytes += statSync(full).size } catch { /* 读不到就不计 */ }
      }
    }
  }
  walk(dir)
  return { bytes, files }
}

export function listTrash(input = {}) {
  const trashRoot = rootOf(input)
  if (!existsSync(trashRoot)) {
    return { ok: true, trashRoot, entries: [], note: '回收站还没有建立（没删过技能）' }
  }
  const entries = []
  for (const item of readdirSync(trashRoot, { withFileTypes: true })) {
    if (!item.isDirectory()) continue
    const dir = join(trashRoot, item.name)
    const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(.+)$/.exec(item.name)
    const deletedAt = match
      ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}`
      : ''
    const guessName = match ? match[7] : item.name
    const { bytes, files } = sizeOf(dir)
    entries.push({
      id: item.name,
      name: readName(dir, guessName),
      deletedAt,
      bytes,
      files,
      path: dir,
    })
  }
  entries.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
  return { ok: true, trashRoot, entries }
}

export function restoreTrash(input = {}) {
  const trashRoot = rootOf(input)
  const targetRoot = typeof input.root === 'string' && input.root.trim() !== ''
    ? resolve(input.root)
    : ''
  if (targetRoot === '') throw new Error('拒绝：没有指定要还原到哪个技能根')
  const dir = entryDir(trashRoot, input.id)
  const folder = /^\d{8}-\d{6}-(.+)$/.exec(String(input.id).trim())
  const name = readName(dir, folder ? folder[1] : String(input.id).trim())
  const dest = join(targetRoot, name)
  if (existsSync(dest)) {
    throw new Error(`同名技能已存在，先改名或删掉它再还原：${dest}`)
  }
  mkdirSync(targetRoot, { recursive: true })
  cpSync(dir, dest, { recursive: true, errorOnExist: true })
  if (!existsSync(join(dest, 'SKILL.md'))) {
    throw new Error(`还原后没看到 SKILL.md，已停下：${dest}`)
  }
  return { ok: true, restored: dest, name, from: dir }
}

export function purgeTrash(input = {}) {
  const trashRoot = rootOf(input)
  const dir = entryDir(trashRoot, input.id)
  rmSync(dir, { recursive: true, force: false })
  return { ok: true, purged: dir, gone: !existsSync(dir) }
}
