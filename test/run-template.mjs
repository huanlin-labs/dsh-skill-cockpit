import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFromTemplate, TEMPLATES } from '../lib/manage-template.js'

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

const base = join(tmpdir(), 'skill-panel-template-test')
rmSync(base, { recursive: true, force: true })
const root = join(base, 'skills')

const blank = createFromTemplate({ name: 'tpl-blank', description: '空白模板创建的技能，用来验证初始形状', root, template: 'blank' })
check('空白：只建 SKILL.md', existsSync(join(blank.dir, 'SKILL.md')) && blank.extraFiles.length === 0, blank)
const blankText = readFileSync(join(blank.dir, 'SKILL.md'), 'utf8')
check('空白：frontmatter 名字正确', blankText.includes('name: tpl-blank'), blankText.slice(0, 60))
check('空白：正文有标题', blankText.includes('# tpl-blank'), blankText)

const script = createFromTemplate({ name: 'tpl-script', description: '带脚本模板创建的技能，验证脚本文件存在', root, template: 'script' })
check('带脚本：生成 scripts/main.mjs', existsSync(join(script.dir, 'scripts', 'main.mjs')), script.extraFiles)
check('带脚本：正文指向脚本', readFileSync(join(script.dir, 'SKILL.md'), 'utf8').includes('scripts/main.mjs'), 'body')

const ref = createFromTemplate({ name: 'tpl-ref', description: '带引用模板创建的技能，验证资料文件存在', root, template: 'reference' })
check('带引用：生成 reference/notes.md', existsSync(join(ref.dir, 'reference', 'notes.md')), ref.extraFiles)
check('带引用：正文指向资料', readFileSync(join(ref.dir, 'SKILL.md'), 'utf8').includes('reference/notes.md'), 'body')

check('未知模板：拒绝', refusal(() => createFromTemplate({ name: 'tpl-x', description: '未知模板应该被拒绝而不是猜', root, template: 'weird' })).includes('未知模板'), 'should refuse')
check('重名：拒绝', refusal(() => createFromTemplate({ name: 'tpl-blank', description: '同名技能应该被拒绝而不是覆盖', root, template: 'blank' })).includes('同名'), 'should refuse')
check('模板清单固定三种', TEMPLATES.join(',') === 'blank,script,reference', TEMPLATES.join(','))

console.log(`\n${pass}/${total} 通过`)
process.exit(pass === total ? 0 : 1)
