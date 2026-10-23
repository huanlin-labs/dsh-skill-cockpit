/**
 * 新建模板：空白 / 带脚本 / 带引用。
 * 模板只决定初始文件形状，不写任何「示例业务内容」——名字与描述仍由用户填。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createSkill } from './manage-write.js'

export const TEMPLATES = ['blank', 'script', 'reference']

export function templateBody({ name, template }) {
  const head = `# ${name}\n\n在这里写这个技能做什么、什么时候用。\n`
  if (template === 'script') return head + `\n## 脚本\n\n本技能带一个可执行脚本：\`scripts/main.mjs\`。\n`
  if (template === 'reference') return head + `\n## 参考\n\n把资料放进 \`reference/notes.md\`，正文只留结论。\n`
  return head
}

export function templateFiles({ name, template }) {
  if (template === 'script') {
    return {
      'scripts/main.mjs': `// ${name} · 入口脚本\n// 运行：node scripts/main.mjs\nexport function main(argv = []) {\n  console.log('${name}', argv)\n}\n\nmain(process.argv.slice(2))\n`,
    }
  }
  if (template === 'reference') {
    return { 'reference/notes.md': `# ${name} · 参考资料\n\n- 来源：\n- 要点：\n` }
  }
  return {}
}

export function createFromTemplate({ name, description, root, template = 'blank' }) {
  if (TEMPLATES.indexOf(template) === -1) throw new Error(`未知模板：${template}（可选 blank / script / reference）`)
  const result = createSkill({ name, description, root, body: templateBody({ name, template }) })
  const dir = join(root, name)
  const files = templateFiles({ name, template })
  for (const rel of Object.keys(files)) {
    const full = join(dir, rel)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, files[rel], 'utf8')
  }
  return { ok: true, name, dir, template, extraFiles: Object.keys(files), result }
}
