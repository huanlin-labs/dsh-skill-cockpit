/**
 * 管理功能自测（0.6.38）：创建 / 读回 / 编辑 / 删除进回收站 / 导入不覆盖 + 六类拒绝。
 * 全部跑在 D:\临时 的沙箱目录里，不碰真实技能根。
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createSkill,
  deleteSkill,
  importSkill,
  readSkill,
  updateSkill,
} from '../lib/manage-write.js'

let pass = 0
let total = 0
const check = (label, ok, detail) => {
  total += 1
  if (ok) pass += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ← ' + String(detail)}`)
}
const refusal = (fn) => {
  try {
    fn()
    return ''
  } catch (e) {
    return String(e.message)
  }
}

const base = join(tmpdir(), 'skill-panel-manage-test')
rmSync(base, { recursive: true, force: true })
const root = join(base, 'skills')
const trash = join(base, 'trash')
mkdirSync(root, { recursive: true })

const made = createSkill({
  root,
  name: 'suite-demo',
  description: '管理套件创建的演示技能，用来证明创建和读回都正常',
  body: '# 演示\n\n第一版正文。',
})
check('创建：文件落到 <root>/<name>/SKILL.md', made.ok === true && existsSync(made.filePath), made)
const back = readSkill({ filePath: made.filePath, root })
check('读回：name/description/body 一致', back.name === 'suite-demo' && /第一版正文/.test(back.body), back)
check('拒绝：同名再建', /同名技能已存在/.test(refusal(() => createSkill({ root, name: 'suite-demo', description: 'x'.repeat(20), body: 'y' }))))
check('拒绝：中文名', /名字里有中文/.test(refusal(() => createSkill({ root, name: '技能', description: 'x'.repeat(20), body: 'y' }))))
check('拒绝：简介太短', /简介/.test(refusal(() => createSkill({ root, name: 'short-desc', description: '短', body: 'y' }))))

const upd = updateSkill({ filePath: made.filePath, root, description: '管理套件改过的简介，长度足够用来通过校验', body: '# 演示\n\n第二版正文。' })
check('编辑：changed=true 且留下 .bak', upd.changed === true && existsSync(upd.backup), upd)
check('编辑：正文真的变了', /第二版正文/.test(readSkill({ filePath: made.filePath, root }).body))
const same = updateSkill({ filePath: made.filePath, root, description: '管理套件改过的简介，长度足够用来通过校验', body: '# 演示\n\n第二版正文。' })
check('编辑：内容相同 -> changed=false（不写盘）', same.changed === false, same)

mkdirSync(join(base, 'incoming', 'import-me'), { recursive: true })
writeFileSync(join(base, 'incoming', 'import-me', 'SKILL.md'), '---\nname: import-me\ndescription: 从本地目录导入的演示技能，内容应当完整复制过来\n---\n\n# 导入\n', 'utf8')
const imp = importSkill({ sourceDir: join(base, 'incoming', 'import-me'), root })
check('导入：复制成功', imp.imported === true && existsSync(imp.filePath), imp)
check('拒绝：导入同名不覆盖', /同名技能已存在/.test(refusal(() => importSkill({ sourceDir: join(base, 'incoming', 'import-me'), root }))))
mkdirSync(join(base, 'incoming', 'empty'), { recursive: true })
check('拒绝：来源没有 SKILL.md', /没有 SKILL.md/.test(refusal(() => importSkill({ sourceDir: join(base, 'incoming', 'empty'), root }))))

const bad = join(base, 'incoming', 'gbk-skill')
mkdirSync(bad, { recursive: true })
writeFileSync(join(bad, 'SKILL.md'), Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0x0a]))
check('拒绝：非 UTF-8 文件改不了', refusal(() => updateSkill({ filePath: join(bad, 'SKILL.md'), root, description: '这段简介长度足够通过校验用来触发UTF8检查', body: '# x' })) !== '')
check('拒绝：路径穿越（../）', refusal(() => updateSkill({ filePath: join(root, '..', 'escape.md'), root, description: '这段简介长度足够通过校验用来触发路径检查', body: '# x' })) !== '')

const del = deleteSkill({ filePath: made.filePath, root, trashRoot: trash })
check('删除：原件消失', del.deleted === true && !existsSync(made.filePath), del)
check('删除：回收站里有完整副本', existsSync(join(del.trashPath, 'SKILL.md')), del.trashPath)
check('拒绝：不在可写根里的目标不给删', /不在可写技能根/.test(refusal(() => deleteSkill({ filePath: join(base, 'incoming', 'import-me', 'SKILL.md'), root, trashRoot: trash }))))

console.log(`\n=== 管理自测：${pass}/${total} 通过 ===`)
if (pass !== total) process.exitCode = 1
