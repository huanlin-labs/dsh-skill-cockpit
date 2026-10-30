/**
 * 一键修自测（0.6.39）：缺 name / name 不匹配 / YAML 冒号 / 短描述 / 缺描述 / 拒绝与备份。
 * 全部在 D:\临时 沙箱里跑。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { planRepair, repairSkill } from '../lib/manage-repair.js'
import { readSkill } from '../lib/manage-write.js'

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

const base = join(tmpdir(), 'skill-panel-repair-test')
rmSync(base, { recursive: true, force: true })
const root = join(base, 'skills')
const make = (dir, text) => {
  const folder = join(root, dir)
  mkdirSync(folder, { recursive: true })
  const file = join(folder, 'SKILL.md')
  writeFileSync(file, text, 'utf8')
  return file
}

const f1 = make('no-name', '---\ndescription: 这是一个没有 name 字段的技能，用来验证补名\n---\n\n# 正文\n')
const r1 = repairSkill({ filePath: f1, root })
check('缺 name：补成目录名', r1.changed === true && readFileSync(f1, 'utf8').includes('name: no-name'), r1)
check('缺 name：留了备份', typeof r1.backup === 'string' && existsSync(r1.backup), r1.backup)
check('缺 name：备份是原内容', !readFileSync(r1.backup, 'utf8').includes('name: no-name'), 'backup')

const f2 = make('right-name', '---\nname: wrong-name\ndescription: 名字和目录不一致时应该改成目录名，这条描述足够长不需要修\n---\n\n正文\n')
const r2 = repairSkill({ filePath: f2, root })
check('name 不匹配：改成目录名', r2.changed === true && /name: right-name/.test(readFileSync(f2, 'utf8')), r2.fixes)

const f3 = make('colon-desc', '---\nname: colon-desc\ndescription: 先做 A: 再做 B，这一行不加引号会被 YAML 截断\n---\n\n正文\n')
const r3 = repairSkill({ filePath: f3, root })
const t3 = readFileSync(f3, 'utf8')
check('YAML 冒号：整段加引号', r3.changed === true && /description: ".*A: 再做 B/.test(t3), t3.split('\n')[2])

const f4 = make('short-desc', '---\nname: short-desc\ndescription: 短\n---\n\n# 用正文第一段当简介\n\n更多内容\n')
const r4 = repairSkill({ filePath: f4, root })
const t4 = readFileSync(f4, 'utf8')
check('短描述：保留原词并补上正文第一段', t4.includes('短——用正文第一段当简介'), t4.split('\n')[2])

// 真实场景：13 字的描述，体检报「少于阈值 20」，一键修必须真能修（原来阈值 8 → changed=false，按钮像死的）
const f4b = make('short-desc-13', '---\nname: short-desc-13\ndescription: 女娲 · Skill造人术\n---\n\n# 女娲\n\n把一本书蒸馏成一组可执行技能，含世界观、人物与章节骨架。\n')
const r4b = repairSkill({ filePath: f4b, root })
const d4b = /^description\s*:\s*"?(.*?)"?$/m.exec(readFileSync(f4b, 'utf8'))[1]
check('13 字描述：一键修真生效且 ≥20 字', r4b.changed === true && d4b.length >= 20, { r4b, d4b })

const f4c = make('short-desc-nobody', '---\nname: short-desc-nobody\ndescription: 女娲 · Skill造人术\n---\n\n')
const r4c = repairSkill({ filePath: f4c, root })
check('短描述但正文无句子：不静默，给出原因', r4c.changed === false && String(r4c.reason).includes('13'), r4c)

const f5 = make('no-desc', '---\nname: no-desc\n---\n\n这是正文里的一句话，长度足够当描述。\n')
const r5 = repairSkill({ filePath: f5, root })
check('缺描述：从正文补', readFileSync(f5, 'utf8').includes('这是正文里的一句话'), r5.fixes)

const f6 = make('no-body', '---\nname: no-body\n---\n\n')
check('缺描述且正文空：拒绝而不是编', refusal(() => repairSkill({ filePath: f6, root })).includes('拒绝'), 'should refuse')

const f7 = make('no-front', '# 只有正文，没有 frontmatter\n')
check('没有 frontmatter：拒绝', refusal(() => repairSkill({ filePath: f7, root })).includes('拒绝'), 'should refuse')

const outside = join(base, 'outside.md')
writeFileSync(outside, '---\nname: x\n---\n')
check('根外文件：拒绝', refusal(() => repairSkill({ filePath: outside, root })).includes('拒绝'), 'should refuse')

const f8 = make('already-ok', '---\nname: already-ok\ndescription: 这个技能本来就完整，不需要任何修复动作\n---\n\n正文内容\n')
const r8 = repairSkill({ filePath: f8, root })
check('本来就完整：changed=false', r8.changed === false && r8.fixes.length === 0, r8)

const back = readSkill({ filePath: f1, root })
check('修完能被 readSkill 正常读回', back.name === 'no-name' && back.description.length >= 8, back)
const again = repairSkill({ filePath: f1, root })
check('再跑一次：幂等', again.changed === false, again)

console.log(`\n${pass}/${total} 通过`)
process.exit(pass === total ? 0 : 1)
