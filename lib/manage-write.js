/**
 * dsh-skill-panel · 管理功能（真的落盘）
 *
 * 户主 2026-10-23 批准的范围，只有两件事：
 *   1. 创建技能 —— 只在可写技能根下新建 <name>/SKILL.md（默认 ~/.dsh/skills）
 *   2. 编辑技能 —— 只改已存在的 SKILL.md 的 description / when-to-use / 正文
 *
 * 四条护栏（和四态开关同一套标准，不是新发明）：
 *   - 只碰「可写技能根」里的入口文件；项目级根、别人的技能一律拒绝；
 *   - 改前先写 <文件>.bak-<时间戳>，改完必须能看到备份；
 *   - UTF-8 字节回环校验，非 UTF-8 文件拒绝（重新编码会毁内容）；
 *   - 先写 .tmp 再 rename，崩在中途也不会留下半个 SKILL.md。
 *
 * 不做：删除、导入、改名、批量。那些要单独批。
 */
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { buildSkillFile, validateBody, validateDescription, validateSkillName } from './manage.js'

const ENTRY = 'SKILL.md'
const DISABLED = 'SKILL.md.disabled'

function realOrSelf(p) {
  try {
    return realpathSync(p)
  } catch {
    return resolve(p)
  }
}

/** 目标必须落在 root 之内（含 root 本身不算），并返回相对段。 */
function containedSegments(root, target) {
  const base = realOrSelf(root)
  const t = realOrSelf(target)
  if (t === base) return []
  if (!t.startsWith(base.endsWith(sep) ? base : base + sep)) return undefined
  return t.slice(base.length).split(sep).filter(Boolean)
}

/** 解析并校验「这个入口文件能不能被本插件改」。 */
function claimEntry(filePath, root) {
  if (typeof filePath !== 'string' || filePath.trim() === '') throw new Error('缺少 filePath')
  if (typeof root !== 'string' || root.trim() === '') throw new Error('缺少可写技能根')
  const abs = resolve(filePath)
  if (!existsSync(abs)) throw new Error(`文件不存在：${abs}`)
  const info = lstatSync(abs)
  if (!info.isFile()) throw new Error('拒绝：编辑目标不是普通文件')
  const segs = containedSegments(root, abs)
  if (segs === undefined) throw new Error('拒绝：目标不在可写技能根里（项目级根只读）')
  const name = segs[segs.length - 1]
  const ok = (segs.length === 1 && /\.md$/.test(name)) || (segs.length === 2 && name === ENTRY)
  if (!ok) throw new Error('拒绝：只有技能入口文件（<目录>/SKILL.md 或 <根>/x.md）能编辑')
  return { abs: realOrSelf(abs), segments: segs }
}

/** UTF-8 严格读取；非 UTF-8 直接拒绝。 */
function readUtf8(file) {
  const raw = readFileSync(file)
  const text = raw.toString('utf8')
  if (!Buffer.from(text, 'utf8').equals(raw)) {
    throw new Error('拒绝：这个文件不是 UTF-8（重新编码会破坏内容），本插件不改它')
  }
  return text
}

/** 拆 frontmatter 与正文；没有 frontmatter 时 fm 为 null。 */
function splitSkill(text) {
  const normalized = text.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) return { fm: null, body: normalized }
  const end = normalized.indexOf('\n---', 4)
  if (end < 0) return { fm: null, body: normalized }
  const fm = normalized.slice(4, end)
  const body = normalized.slice(end + 4).replace(/^\n+/, '')
  return { fm, body }
}

/** 读出来给编辑表单用。 */
export function readSkill({ filePath, root }) {
  const { abs } = claimEntry(filePath, root)
  const { fm, body } = splitSkill(readUtf8(abs))
  const get = (key) => {
    if (fm === null) return ''
    const m = new RegExp(`^${key}\\s*:\\s*(.*)$`, 'm').exec(fm)
    return m === null ? '' : m[1].trim()
  }
  return {
    filePath: abs,
    name: get('name') || basename(dirname(abs)) || basename(abs).replace(/\.md$/, ''),
    description: get('description'),
    whenToUse: get('when-to-use'),
    body: body.trimEnd(),
  }
}

/**
 * 改 frontmatter 里的两个键，其余行原样保留（包括用户自己写的键）。
 * 没有 frontmatter 时补一个最小块 —— 这正是体检里 invalid-entry 的那类文件。
 */
function rewriteSkill(text, { description, whenToUse, body }) {
  const { fm, body: oldBody } = splitSkill(text)
  const lines = fm === null ? [] : fm.split('\n')
  const set = (key, value) => {
    const i = lines.findIndex((l) => new RegExp(`^${key}\\s*:`).test(l))
    if (value === '') {
      if (i >= 0) lines.splice(i, 1)
      return
    }
    if (i >= 0) lines[i] = `${key}: ${value}`
    else lines.push(`${key}: ${value}`)
  }
  set('description', description)
  set('when-to-use', whenToUse)
  const fmText = lines.length === 0 ? '' : `---\n${lines.join('\n')}\n---\n\n`
  const nextBody = body === undefined ? oldBody.trim() : body
  return `${fmText}${nextBody}\n`
}

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** 原子写：临时文件 + rename。 */
function writeAtomic(target, text) {
  const tmp = join(dirname(target), `.${basename(target)}.tmp-${process.pid}-${Date.now()}`)
  writeFileSync(tmp, text, 'utf8')
  try {
    renameSync(tmp, target)
  } catch (error) {
    rmSync(tmp, { force: true })
    throw error
  }
}

/**
 * 创建技能。
 * @param {{root:string, name:string, description:string, body:string, whenToUse?:string}} input
 */
export function createSkill(input = {}) {
  const root = input.root
  if (typeof root !== 'string' || root.trim() === '') throw new Error('缺少可写技能根')
  const built = buildSkillFile(input)
  if (built.error !== undefined) throw new Error(built.error)
  const name = validateSkillName(input.name).value

  const rootAbs = resolve(root)
  if (!existsSync(rootAbs)) mkdirSync(rootAbs, { recursive: true })
  if (!lstatSync(rootAbs).isDirectory()) throw new Error(`技能根不是目录：${rootAbs}`)

  const dir = join(rootAbs, name)
  if (existsSync(dir)) throw new Error(`同名技能已存在：${dir}（换一个名字，或去列表里编辑它）`)

  mkdirSync(dir)
  const file = join(dir, ENTRY)
  try {
    writeAtomic(file, built.text)
  } catch (error) {
    rmSync(dir, { recursive: true, force: true })
    throw error
  }
  return { ok: true, created: true, filePath: file, name }
}

/** 编辑技能（只改 description / when-to-use / 正文）。 */
export function updateSkill(input = {}) {
  const { abs } = claimEntry(input.filePath, input.root)
  const before = readUtf8(abs)

  const description = validateDescription(input.description)
  if (!description.ok) throw new Error(description.error)
  const body = validateBody(input.body)
  if (!body.ok) throw new Error(body.error)
  const when = typeof input.whenToUse === 'string' ? input.whenToUse.replace(/[\r\n]+/g, ' ').trim() : ''

  const next = rewriteSkill(before, {
    description: description.value,
    whenToUse: when,
    body: body.value,
  })
  if (next === before) return { ok: true, changed: false, filePath: abs }

  const backup = `${abs}.bak-${stamp()}`
  writeFileSync(backup, before, 'utf8')
  if (!existsSync(backup)) throw new Error('备份没写成功，已中止（原文件未动）')
  writeAtomic(abs, next)
  return { ok: true, changed: true, filePath: abs, backup }
}

/**
 * 删除技能：先把整个技能目录（或单文件技能）复制进回收站，确认复制成功才删原件。
 * 户主令：删除必须进 D:\回收站，不许直接抹掉。
 */
export function deleteSkill(input = {}) {
  const { abs, segments } = claimEntry(input.filePath, input.root)
  const trashRoot =
    typeof input.trashRoot === 'string' && input.trashRoot.trim() !== ''
      ? resolve(input.trashRoot)
      : 'D:\\回收站\\技能面板删除'
  const isDirSkill = segments.length === 2
  const target = isDirSkill ? dirname(abs) : abs
  const name = isDirSkill ? basename(dirname(abs)) : basename(abs)
  const base = `${stamp()}-${name}`

  mkdirSync(trashRoot, { recursive: true })
  // 同一秒里连删两次（工具连调很常见）会撞名：顺延 -2、-3，绝不覆盖已有条目。
  let dest = join(trashRoot, base)
  for (let n = 2; existsSync(dest); n += 1) dest = join(trashRoot, `${base}-${n}`)
  cpSync(target, dest, { recursive: true, errorOnExist: true, force: false })
  if (!existsSync(dest)) throw new Error('复制到回收站失败，原文件未动')
  rmSync(target, { recursive: true, force: false })
  return { ok: true, deleted: true, trashPath: dest, skillDir: isDirSkill ? target : null }
}

/**
 * 导入技能：只从用户指定的本地目录复制（目录里必须有 SKILL.md）。
 * 同名一律拒绝 —— 导入永远不覆盖已有技能。
 */
export function importSkill(input = {}) {
  if (typeof input.sourceDir !== 'string' || input.sourceDir.trim() === '') {
    throw new Error('缺少来源目录')
  }
  const source = resolve(input.sourceDir)
  if (!existsSync(source)) throw new Error(`来源目录不存在：${source}`)
  if (!lstatSync(source).isDirectory()) throw new Error('来源必须是目录（目录里放 SKILL.md）')
  const entry = join(source, ENTRY)
  if (!existsSync(entry)) throw new Error(`来源目录里没有 ${ENTRY}：${source}`)

  const nameCheck = validateSkillName(input.name ?? basename(source))
  if (!nameCheck.ok) throw new Error(`${nameCheck.error}（可用 name 参数另指定合法名字）`)
  const name = nameCheck.value

  if (typeof input.root !== 'string' || input.root.trim() === '') throw new Error('缺少可写技能根')
  const root = resolve(input.root)
  const target = join(root, name)
  if (existsSync(target)) throw new Error(`同名技能已存在：${target}（导入不会覆盖）`)
  if (!existsSync(root)) mkdirSync(root, { recursive: true })

  cpSync(source, target, { recursive: true, errorOnExist: true, force: false })
  if (!existsSync(join(target, ENTRY))) {
    rmSync(target, { recursive: true, force: true })
    throw new Error(`复制后没找到 ${ENTRY}，已回滚`)
  }
  return { ok: true, imported: true, name, filePath: join(target, ENTRY) }
}
