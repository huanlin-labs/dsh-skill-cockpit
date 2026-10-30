/**
 * dsh-skill-panel · DSH 预设（agent presets）的技能挂载
 *
 * 一个预设 = `~/.dsh/.agent-presets/<id>/` 一个文件夹：
 *   preset.yml          名字 / 简介 / 排序
 *   agent.cordis.yml    组装声明（里面 customSkillDirs 指向本预设的 skills/）
 *   skills/             这个预设带哪些技能
 *
 * 本模块只做一件事：把「全局技能库里的一个技能」以 **junction** 挂进某个预设的
 * skills/ 下，或者把那条 junction 撤掉。技能本体永远留在全局库里、位置不动。
 *
 * 安全边界：
 *   · 只删 **链接**（lstat().isSymbolicLink()），真实目录一律拒绝——别人手工放进去的
 *     技能不能被一条误点删掉。
 *   · presetId 只接受文件夹名里的安全字符，禁止路径穿越。
 *   · 挂载目标必须来自调用方给的 pool（扫描结果），且必须存在 SKILL.md。
 */

import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, symlinkSync, unlinkSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

const PRESETS_DIR = '.agent-presets'
const SAFE_ID = /^[A-Za-z0-9._-]+$/
const BAD_IDS = new Set(['.', '..'])

function readMeta(filePath) {
  const out = { name: '', description: '', order: 0 }
  if (!existsSync(filePath)) return out
  let text = ''
  try {
    text = readFileSync(filePath, 'utf8')
  } catch {
    return out
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z_]+):\s*(.*)$/.exec(line)
    if (!m) continue
    const key = m[1]
    let value = m[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key === 'name') out.name = value
    else if (key === 'description') out.description = value
    else if (key === 'order') out.order = Number(value) || 0
  }
  return out
}

/** 从 SKILL.md 里抠 frontmatter 的 description（只读前 8KB，拿不到就空串）。 */
function readDescription(dir) {
  for (const name of ['SKILL.md', 'SKILL.md.disabled']) {
    const file = join(dir, name)
    if (!existsSync(file)) continue
    try {
      const head = readFileSync(file, 'utf8').slice(0, 8192)
      const m = /^description:\s*(.+)$/m.exec(head)
      if (!m) return ''
      let value = m[1].trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      return value.length > 160 ? value.slice(0, 160) + '…' : value
    } catch {
      return ''
    }
  }
  return ''
}

/** 读出所有预设 + 每个预设已挂的技能（链接 / 真实目录分开标）。 */
export function listAgentPresets({ dshHome, pool = [] }) {
  const root = join(dshHome, PRESETS_DIR)
  if (!existsSync(root)) return { ok: true, root, presets: [], pool }
  const presets = []
  for (const dirent of readdirSync(root, { withFileTypes: true })) {
    if (!dirent.isDirectory() || !SAFE_ID.test(dirent.name)) continue
    const dir = join(root, dirent.name)
    const meta = readMeta(join(dir, 'preset.yml'))
    const skillsDir = join(dir, 'skills')
    const mounted = []
    if (existsSync(skillsDir)) {
      for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
        const full = join(skillsDir, entry.name)
        let isLink = false
        let target = null
        try {
          isLink = lstatSync(full).isSymbolicLink()
          if (isLink) target = realpathSync(full)
        } catch {
          /* 读不到就按普通目录处理 */
        }
        mounted.push({
          name: entry.name,
          link: isLink,
          target,
          description: readDescription(full),
          hasSkill: existsSync(join(full, 'SKILL.md')),
        })
      }
    }
    mounted.sort((a, b) => a.name.localeCompare(b.name))
    presets.push({
      id: dirent.name,
      name: meta.name || dirent.name,
      description: meta.description,
      order: meta.order,
      mounted,
    })
  }
  presets.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  return { ok: true, root, presets, pool }
}

function presetDir(dshHome, presetId) {
  if (typeof presetId !== 'string' || !SAFE_ID.test(presetId) || BAD_IDS.has(presetId)) {
    return { error: '预设 id 不合法' }
  }
  const root = resolve(dshHome, PRESETS_DIR)
  const dir = resolve(root, presetId)
  // 只允许真正落在 .agent-presets/ 下的一层目录（挡住 .. 与其它穿越写法）
  if (!dir.startsWith(root + sep) || dir.slice(root.length + 1).includes(sep)) {
    return { error: '预设 id 不合法' }
  }
  if (!existsSync(dir)) return { error: `没有这个预设：${presetId}` }
  return { dir }
}

function findInPool(pool, skillName) {
  const hit = (pool || []).find((row) => row && row.name === skillName)
  if (!hit) return { error: `全局技能库里没有：${skillName}` }
  const target = hit.directory || hit.dir || hit.path
  if (!target || !existsSync(target)) return { error: `技能目录不存在：${skillName}` }
  if (!existsSync(join(target, 'SKILL.md'))) return { error: `${skillName} 不是技能（没有 SKILL.md）` }
  return { target }
}

/** 把一个全局技能以 junction 挂进预设的 skills/。 */
export function mountAgentSkill({ dshHome, presetId, skillName, pool }) {
  const preset = presetDir(dshHome, presetId)
  if (preset.error) return { ok: false, error: preset.error }
  const found = findInPool(pool, skillName)
  if (found.error) return { ok: false, error: found.error }
  const skillsDir = join(preset.dir, 'skills')
  if (!existsSync(skillsDir)) mkdirSync(skillsDir, { recursive: true })
  const linkPath = join(skillsDir, skillName)
  if (existsSync(linkPath)) {
    const isLink = lstatSync(linkPath).isSymbolicLink()
    if (isLink) return { ok: false, error: `${skillName} 已经挂在这个预设里了` }
    return { ok: false, error: `${skillName} 在预设里是真实目录（不是链接），不动它` }
  }
  symlinkSync(found.target, linkPath, 'junction')
  return { ok: true, presetId, skillName, linkPath, target: found.target }
}

/**
 * 把预设里自带的**真实目录**移出去：搬到全局技能库（<dshHome>/skills/<name>）。
 *
 * 为什么不直接删：预设自带的是真技能，删掉就没了。移出 = 预设不再带它、库里多一个
 * 可被任意预设挂载的副本，用户随时能再挂回来。同名冲突一律拒绝，绝不覆盖。
 */
export function detachAgentSkill({ dshHome, presetId, skillName }) {
  const preset = presetDir(dshHome, presetId)
  if (preset.error) return { ok: false, error: preset.error }
  if (typeof skillName !== 'string' || skillName === '' || BAD_IDS.has(skillName) || skillName.includes('/') || skillName.includes('\\')) {
    return { ok: false, error: '技能名不合法' }
  }
  const src = join(preset.dir, 'skills', skillName)
  if (!existsSync(src)) return { ok: false, error: `${skillName} 不在这个预设里` }
  let isLink = false
  try {
    isLink = lstatSync(src).isSymbolicLink()
  } catch (error) {
    return { ok: false, error: `读不到 ${skillName}：${error?.message ?? error}` }
  }
  if (isLink) return { ok: false, error: `${skillName} 是链接，用「摘掉」` }
  if (!existsSync(join(src, 'SKILL.md')) && !existsSync(join(src, 'SKILL.md.disabled'))) {
    return { ok: false, error: `${skillName} 不是技能目录（没有 SKILL.md），不动它` }
  }
  const pool = join(resolve(dshHome), 'skills')
  mkdirSync(pool, { recursive: true })
  const dest = join(pool, skillName)
  if (existsSync(dest)) return { ok: false, error: `全局技能库里已经有 ${skillName} 了，先把同名的处理掉` }
  renameSync(src, dest)
  return { ok: true, presetId, skillName, movedTo: dest }
}

/** 撤掉一条 junction。只删链接，真实目录拒绝。 */
export function unmountAgentSkill({ dshHome, presetId, skillName }) {
  const preset = presetDir(dshHome, presetId)
  if (preset.error) return { ok: false, error: preset.error }
  const linkPath = join(preset.dir, 'skills', skillName)
  if (!existsSync(linkPath)) return { ok: false, error: `${skillName} 不在这个预设里` }
  let isLink = false
  try {
    isLink = lstatSync(linkPath).isSymbolicLink()
  } catch (error) {
    return { ok: false, error: `读不到 ${skillName}：${error?.message ?? error}` }
  }
  if (!isLink) {
    return { ok: false, error: `${skillName} 是预设里的真实目录，不是链接，我不删（请手工处理）` }
  }
  process.platform === 'win32' ? rmdirSync(linkPath) : unlinkSync(linkPath)
  return { ok: true, presetId, skillName }
}
