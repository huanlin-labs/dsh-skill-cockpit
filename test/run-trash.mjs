/**
 * 回收站自测（0.6.39）：列表 / 还原 / 同名拒绝 / 路径穿越拒绝 / 彻底删除。
 * 全部在 D:\临时 沙箱里跑；不碰真实技能根与真实回收站。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createSkill, deleteSkill } from '../lib/manage-write.js'
import { listTrash, purgeTrash, restoreTrash } from '../lib/manage-trash.js'

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

const base = 'D:/临时/skill-panel-trash-test'
rmSync(base, { recursive: true, force: true })
const root = join(base, 'skills')
const trash = join(base, 'trash')
mkdirSync(root, { recursive: true })

const empty = listTrash({ trashRoot: trash })
check('空回收站：entries 为空且有说明', empty.entries.length === 0 && typeof empty.note === 'string', empty)

const made = createSkill({ root, name: 'trash-demo', description: '回收站套件用的演示技能，用来验证还原与彻底删除', body: '# 演示\n\n内容一。' })
deleteSkill({ filePath: made.filePath, root, trashRoot: trash })

const listed = listTrash({ trashRoot: trash })
check('列表：看到 1 条', listed.entries.length === 1, listed)
const entry = listed.entries[0]
check('列表：名字从 frontmatter 读回', entry.name === 'trash-demo', entry)
check('列表：有时间戳', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(entry.deletedAt), entry.deletedAt)
check('列表：统计文件数与字节', entry.files >= 1 && entry.bytes > 0, entry)

const restoredRoot = join(base, 'restored')
const restored = restoreTrash({ trashRoot: trash, root: restoredRoot, id: entry.id })
check('还原：落到目标根', restored.ok === true && existsSync(join(restoredRoot, 'trash-demo', 'SKILL.md')), restored)
check('还原：正文一致', existsSync(join(restoredRoot, 'trash-demo', 'SKILL.md')) && readUtf8(join(restoredRoot, 'trash-demo', 'SKILL.md')).includes('内容一'), 'body')
function readUtf8(file) { return readFileSync(file, 'utf8') }

const dup = refusal(() => restoreTrash({ trashRoot: trash, root: restoredRoot, id: entry.id }))
check('还原：同名已存在时拒绝', dup.includes('同名技能已存在'), dup)

const traversal = refusal(() => restoreTrash({ trashRoot: trash, root: restoredRoot, id: '../escape' }))
check('还原：路径穿越被拒', traversal !== '' && traversal.includes('拒绝'), traversal)

const missing = refusal(() => restoreTrash({ trashRoot: trash, root: restoredRoot, id: '20260101-000000-nope' }))
check('还原：不存在的条目被拒', missing.includes('没有这一条'), missing)

writeFileSync(join(base, 'outside.txt'), 'must survive')
const purgeEscape = refusal(() => purgeTrash({ trashRoot: trash, id: '..' }))
check('彻底删除：.. 被拒且站外文件还在', purgeEscape !== '' && existsSync(join(base, 'outside.txt')), purgeEscape)

const made2 = createSkill({ root, name: 'trash-demo-2', description: '回收站套件第二条演示技能，用来验证彻底删除', body: '# 二' })
deleteSkill({ filePath: made2.filePath, root, trashRoot: trash })
const listed2 = listTrash({ trashRoot: trash })
check('列表：两条按时间倒序', listed2.entries.length === 2 && listed2.entries[0].id >= listed2.entries[1].id, listed2.entries.map(e => e.id))
const purged = purgeTrash({ trashRoot: trash, id: listed2.entries[0].id })
check('彻底删除：条目消失', purged.gone === true, purged)
check('彻底删除：只删一条', listTrash({ trashRoot: trash }).entries.length === 1, 'count')

console.log(`\n${pass}/${total} 通过`)
process.exit(pass === total ? 0 : 1)
