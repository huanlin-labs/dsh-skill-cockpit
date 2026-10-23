/**
 * 一键修：只做「不改语义、只补结构」的修复。
 *
 * 允许的修复（其余一律拒绝，绝不猜内容）：
 *  1. 缺 name        → 用目录名补
 *  2. name ≠ 目录名   → 改成目录名（DSH 以目录名定位入口）
 *  3. 缺 description → 用正文第一段（≥8 字）截到 200 字补
 *  4. description 里有未加引号的冒号（YAML 会截断）→ 整段加双引号并转义
 *  5. 缺 when-to-use → 不补（可选字段，补了就是编）
 *
 * 任何写入前都先留 .bak-<stamp>，原子替换；没有可修的返回 changed:false。
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function isInside(root, filePath) {
  const r = resolve(root)
  const p = resolve(filePath)
  return p === r || p.startsWith(r + '\\') || p.startsWith(r + '/')
}

function splitFront(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!match) return null
  return {
    head: match[1],
    body: text.slice(match[0].length),
    prefixLen: match[0].length - match[1].length - (match[0].length - match[1].length - 4),
  }
}

function firstSentence(body) {
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/^#+\s*/, '').trim()
    if (line === '' || line === '---') continue
    if (line.length >= 8) return line.length > 200 ? line.slice(0, 200) : line
  }
  return ''
}

export function planRepair({ filePath, root }) {
  if (!isInside(root, filePath)) throw new Error('拒绝：目标不在可写技能根里（项目级根只读）')
  if (!existsSync(filePath)) throw new Error(`文件不存在：${filePath}`)
  const raw = readFileSync(filePath, 'utf8')
  const dirName = basename(dirname(filePath))
  const fixes = []
  let text = raw

  const split = splitFront(text)
  if (!split) throw new Error('拒绝：没有 frontmatter，自动补会猜内容；请手动编辑')

  let head = split.head
  const body = split.body
  const lines = head.split(/\r?\n/)
  const find = (key) => {
    const i = lines.findIndex((l) => new RegExp(`^${key}\\s*:`).test(l))
    return i === -1 ? null : i
  }
  const valueOf = (i) => {
    const rawValue = lines[i].replace(/^\w[\w-]*\s*:/, '').trim()
    return rawValue.replace(/^["']|["']$/g, '')
  }

  // 1 / 2 · name
  const nameIdx = find('name')
  if (nameIdx === null) {
    lines.unshift(`name: ${dirName}`)
    fixes.push(`补 name: ${dirName}`)
  } else if (valueOf(nameIdx) !== dirName) {
    const old = valueOf(nameIdx)
    lines[nameIdx] = `name: ${dirName}`
    fixes.push(`name ${old} → ${dirName}`)
  }

  // 3 / 4 · description
  const descIdx = find('description')
  if (descIdx === null) {
    const guess = firstSentence(body)
    if (guess === '') throw new Error('拒绝：description 缺失且正文里找不到可用的一句；请手动填写')
    lines.push(`description: "${guess.replace(/"/g, '\\"')}"`)
    fixes.push('补 description（取自正文第一段）')
  } else {
    const rawValue = lines[descIdx].replace(/^description\s*:/, '').trim()
    const unquoted = !/^["']/.test(rawValue)
    const value = valueOf(descIdx)
    if (unquoted && rawValue.includes(': ')) {
      lines[descIdx] = `description: "${value.replace(/"/g, '\\"')}"`
      fixes.push('description 加引号（原来含冒号会被 YAML 截断）')
    } else if (value.length < 8) {
      const guess = firstSentence(body)
      if (guess === '') throw new Error('拒绝：description 太短且正文里找不到可用的一句；请手动填写')
      lines[descIdx] = `description: "${guess.replace(/"/g, '\\"')}"`
      fixes.push('description 太短，改用正文第一段')
    }
  }

  head = lines.join('\n')
  text = `---\n${head}\n---\n${body}`
  return { changed: text !== raw, fixes, text, dirName }
}

export function repairSkill({ filePath, root }) {
  const plan = planRepair({ filePath, root })
  if (!plan.changed) return { ok: true, changed: false, fixes: [], filePath }
  const backup = `${filePath}.bak-${stamp()}`
  writeFileSync(backup, readFileSync(filePath))
  const tmp = join(dirname(filePath), `.${basename(filePath)}.repair-tmp`)
  writeFileSync(tmp, plan.text, 'utf8')
  renameSync(tmp, filePath)
  return { ok: true, changed: true, fixes: plan.fixes, backup, filePath }
}
