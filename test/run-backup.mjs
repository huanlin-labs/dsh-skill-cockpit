/**
 * 本地备份自测（0.6.39）：单技能 / 全部 / 拒绝越界 / 不覆盖同名 / 源不动。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_BACKUP_ROOT, backupAll, backupSkill } from '../lib/manage-backup.js'

let pass = 0
let total = 0
const check = (label, ok, detail) => {
  total += 1
  if (ok) pass += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ← ' + String(detail)}`)
}
const refusal = (fn) => {
  try { fn(); return '' } catch (e) { return String(e.message) }
}

check(
  '默认备份根在 DSH home 内，且不写死本机盘符',
  DEFAULT_BACKUP_ROOT.startsWith(join(homedir(), '.dsh')) && !DEFAULT_BACKUP_ROOT.includes('回收站'),
  DEFAULT_BACKUP_ROOT,
)
const base = 'D:/临时/skill-panel-backup-test'
rmSync(base, { recursive: true, force: true })
const rootA = join(base, 'rootA')
const rootB = join(base, 'rootB')
const destRoot = join(base, 'backups')
const make = (root, name, body) => {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), body, 'utf8')
  writeFileSync(join(dir, 'extra.txt'), 'x'.repeat(100), 'utf8')
  return join(dir, 'SKILL.md')
}
const a1 = make(rootA, 'alpha', '---\nname: alpha\ndescription: 这是 alpha 的完整描述\n---\n\n正文\n')
make(rootA, 'beta', '---\nname: beta\ndescription: 这是 beta 的完整描述\n---\n\n正文\n')
make(rootB, 'alpha', '---\nname: alpha\ndescription: 另一个根里的同名技能\n---\n\n正文\n')

const one = backupSkill({ filePath: a1, root: rootA, destRoot })
check('单技能：返回 ok 与目标路径', one.ok === true && existsSync(one.dest), one)
check('单技能：正文被完整复制', readFileSync(join(one.dest, 'SKILL.md'), 'utf8').includes('这是 alpha 的完整描述'), one.dest)
check('单技能：附件也在', existsSync(join(one.dest, 'extra.txt')), one.dest)
check('单技能：文件数与字节数', one.files === 2 && one.bytes > 100, `${one.files}/${one.bytes}`)
check('单技能：源还在', existsSync(a1), a1)

check('根外文件：拒绝', refusal(() => backupSkill({ filePath: join(base, 'outside.md'), root: rootA, destRoot })).includes('拒绝'), 'should refuse')
check('不存在的文件：拒绝', refusal(() => backupSkill({ filePath: join(rootA, 'nope', 'SKILL.md'), root: rootA, destRoot })).includes('不存在'), 'should refuse')

const all = backupAll({ roots: [rootA, rootB], destRoot })
check('全部：两个根共 3 个技能', all.count === 3 && all.skills.length === 3, all.count)
const names = all.skills.map((s) => s.name).sort().join(',')
check('全部：名字集合正确', names === 'alpha,alpha,beta', names)
const destNames = all.skills.map((s) => s.dest.split(/[\\/]/).pop()).sort().join(',')
check('全部：同名未覆盖（带来源前缀）', destNames === 'alpha,beta,rootB__alpha', destNames)
check('全部：都在同一个批次目录', all.skills.every((s) => s.dest.startsWith(all.dest)), all.dest)

console.log(`\n${pass}/${total} 通过`)
process.exit(pass === total ? 0 : 1)
