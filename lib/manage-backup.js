/**
 * 本地备份：把技能整目录复制到备份根（默认 <DSH home>/skill-panel/backups，可传 destRoot 覆盖）。
 * 只读源、只写备份根；不删源、不改源。同名冲突时带来源前缀，绝不覆盖。
 */
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

export const DEFAULT_BACKUP_ROOT = join(homedir(), '.dsh', 'skill-panel', 'backups')

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function isInside(root, p) {
  const r = resolve(root)
  const x = resolve(p)
  return x === r || x.startsWith(r + '\\') || x.startsWith(r + '/')
}

function countFiles(dir) {
  let files = 0
  let bytes = 0
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      const sub = countFiles(full)
      files += sub.files
      bytes += sub.bytes
    } else {
      files += 1
      bytes += st.size
    }
  }
  return { files, bytes }
}

export function backupSkill({ filePath, root, destRoot = DEFAULT_BACKUP_ROOT }) {
  if (!isInside(root, filePath)) throw new Error('拒绝：目标不在可写技能根里（项目级根只读）')
  if (!existsSync(filePath)) throw new Error(`文件不存在：${filePath}`)
  const name = basename(dirname(filePath))
  const dest = join(destRoot, stamp(), name)
  if (existsSync(dest)) throw new Error(`拒绝：备份目标已存在：${dest}`)
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(dirname(filePath), dest, { recursive: true })
  const { files, bytes } = countFiles(dest)
  return { ok: true, name, dest, files, bytes }
}

export function backupAll({ roots, destRoot = DEFAULT_BACKUP_ROOT }) {
  const list = []
  const seen = new Set()
  const batch = join(destRoot, stamp())
  for (const root of roots) {
    if (!existsSync(root)) continue
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dir = join(root, entry.name)
      const file = join(dir, 'SKILL.md')
      if (!existsSync(file)) continue
      let folder = entry.name
      if (seen.has(folder)) {
        const source = basename(root).replace(/[^\w.-]+/g, '-')
        folder = `${source}__${entry.name}`
      }
      seen.add(folder)
      const dest = join(batch, folder)
      mkdirSync(dest, { recursive: true })
      cpSync(dir, dest, { recursive: true })
      const { files, bytes } = countFiles(dest)
      list.push({ name: entry.name, dest, files, bytes })
    }
  }
  return { ok: true, dest: batch, count: list.length, skills: list }
}
