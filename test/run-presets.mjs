/**
 * DSH 预设的技能挂载（agent-presets.js）自测。
 *
 * 重点不是"挂得上"，而是**不该动的绝不动**：
 *   · 预设里的真实目录，unmount 必须拒绝；
 *   · detach 只搬技能目录、同名冲突必须拒绝（绝不覆盖）；
 *   · presetId / skillName 不能路径穿越。
 */
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  detachAgentSkill,
  listAgentPresets,
  mountAgentSkill,
  unmountAgentSkill,
} from '../lib/agent-presets.js'

let pass = 0
let total = 0
const check = (label, ok, detail) => {
  total += 1
  if (ok) pass += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ← ' + JSON.stringify(detail)}`)
}

const home = mkdtempSync(join(tmpdir(), 'cockpit-presets-'))
const presetId = 'demo'
const presetDir = join(home, '.agent-presets', presetId)
const presetSkill = join(presetDir, 'skills', 'preset-skill')
mkdirSync(presetSkill, { recursive: true })
writeFileSync(join(presetDir, 'preset.yml'), 'name: 演示预设\ndescription: 自测\norder: 2\n', 'utf8')
writeFileSync(join(presetSkill, 'SKILL.md'), '---\nname: preset-skill\ndescription: 预设自带\n---\n正文\n', 'utf8')

const globalSkill = join(home, 'skills', 'global-skill')
mkdirSync(globalSkill, { recursive: true })
writeFileSync(join(globalSkill, 'SKILL.md'), '---\nname: global-skill\ndescription: 全局库\n---\n正文\n', 'utf8')
const pool = [{ name: 'global-skill', directory: globalSkill }]

// 1 · 列表
const list0 = listAgentPresets({ dshHome: home, pool })
check(
  '列出预设：名字/排序/自带技能（标为真实目录）',
  list0.presets.length === 1 &&
    list0.presets[0].name === '演示预设' &&
    list0.presets[0].mounted.length === 1 &&
    list0.presets[0].mounted[0].link === false &&
    list0.presets[0].mounted[0].hasSkill === true,
  list0.presets,
)

// 2 · unmount 必须拒绝真实目录
const refuse = unmountAgentSkill({ dshHome: home, presetId, skillName: 'preset-skill' })
check(
  '真实目录 unmount 被拒且目录还在',
  refuse.ok === false && refuse.error.includes('真实目录') && existsSync(join(presetSkill, 'SKILL.md')),
  refuse,
)

// 3 · mount 挂全局技能
const mounted = mountAgentSkill({ dshHome: home, presetId, skillName: 'global-skill', pool })
const linkPath = join(presetDir, 'skills', 'global-skill')
check('mount 建出链接且本体不动', mounted.ok === true && lstatSync(linkPath).isSymbolicLink() && existsSync(join(globalSkill, 'SKILL.md')), mounted)

const again = mountAgentSkill({ dshHome: home, presetId, skillName: 'global-skill', pool })
check('重复 mount 被拒（幂等提示）', again.ok === false && again.error.includes('已经挂'), again)

const list1 = listAgentPresets({ dshHome: home, pool })
const row = list1.presets[0].mounted.find((r) => r.name === 'global-skill')
check('列表把挂载项标为 link 且读到描述', row?.link === true && row?.hasSkill === true, row)

// 4 · unmount 链接
const un = unmountAgentSkill({ dshHome: home, presetId, skillName: 'global-skill' })
check('unmount 只删链接、本体还在', un.ok === true && !existsSync(linkPath) && existsSync(join(globalSkill, 'SKILL.md')), un)

// 5 · detach 把预设自带的真技能搬进全局库
const det = detachAgentSkill({ dshHome: home, presetId, skillName: 'preset-skill' })
const movedTo = join(home, 'skills', 'preset-skill')
check(
  'detach 搬进全局库：源没了、目标有 SKILL.md',
  det.ok === true && !existsSync(presetSkill) && existsSync(join(movedTo, 'SKILL.md')),
  det,
)

// 6 · 同名冲突必须拒绝，不覆盖
const clashDir = join(presetDir, 'skills', 'clash')
mkdirSync(clashDir, { recursive: true })
writeFileSync(join(clashDir, 'SKILL.md'), '---\nname: clash\ndescription: 冲突\n---\n', 'utf8')
const clashDet = detachAgentSkill({ dshHome: home, presetId, skillName: 'clash' }) // 第一次：搬走
const clashAgain = detachAgentSkill({ dshHome: home, presetId, skillName: 'clash' }) // 第二次：源已不在
check('detach 后源不存在再 detach 报「不在这个预设里」', clashAgain.ok === false && clashAgain.error.includes('不在这个预设'), clashAgain)
const clashBack = join(presetDir, 'skills', 'clash')
mkdirSync(clashBack, { recursive: true })
writeFileSync(join(clashBack, 'SKILL.md'), '---\nname: clash\ndescription: 又一份\n---\n', 'utf8')
const clashConflict = detachAgentSkill({ dshHome: home, presetId, skillName: 'clash' })
check(
  '全局库已有同名时 detach 拒绝且两份都在',
  clashConflict.ok === false &&
    clashConflict.error.includes('已经有') &&
    existsSync(join(clashBack, 'SKILL.md')) &&
    readFileSync(join(movedTo, 'SKILL.md'), 'utf8').includes('正文'),
  clashConflict,
)

// 7 · 非法 id / 名字
const badId = mountAgentSkill({ dshHome: home, presetId: '../evil', skillName: 'global-skill', pool })
check('presetId 路径穿越被拒', badId.ok === false && badId.error.includes('不合法'), badId)
const missing = mountAgentSkill({ dshHome: home, presetId: 'nope', skillName: 'global-skill', pool })
check('不存在的预设被拒', missing.ok === false && missing.error.includes('没有这个预设'), missing)
const badName = detachAgentSkill({ dshHome: home, presetId, skillName: '../x' })
check('技能名带路径分隔符被拒', badName.ok === false, badName)
const noPool = mountAgentSkill({ dshHome: home, presetId, skillName: 'ghost', pool })
check('全局库没有该技能时被拒', noPool.ok === false && noPool.error.includes('没有：ghost'), noPool)

// 8 · 空 home：没有预设目录也不报错
const emptyHome = mkdtempSync(join(tmpdir(), 'cockpit-presets-empty-'))
const empty = listAgentPresets({ dshHome: emptyHome, pool: [] })
check('空 home 返回 ok 且 presets 为空', empty.ok === true && empty.presets.length === 0, empty)

rmSync(home, { recursive: true, force: true })
rmSync(emptyHome, { recursive: true, force: true })
console.log(`\n${pass}/${total} 通过`)
process.exit(pass === total ? 0 : 1)
