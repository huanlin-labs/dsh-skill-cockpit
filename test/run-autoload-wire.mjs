/**
 * 自动加载 · 运行时接线自测（临时目录，不碰真实技能目录）
 *
 * 验的是「装到 dsh 里之后会不会坏」：
 *   - 设置文件读写：默认关、合并写、坏文件回落
 *   - 技能索引：正文缓存按 mtime 失效、frontmatter 剥离
 *   - planInjection：关着不动、开着才注入、注入位置正确、不修改原数组
 */
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clearBodyCache,
  indexFromRows,
  planInjection,
  readSettings,
  readSkillBody,
  settingsPath,
  stripFrontmatter,
  writeProbe,
  writeSettings,
} from '../lib/autoload-runtime.js';
import { SOURCE_KIND } from '../lib/autoload.js';

const lines = [];
let failures = 0;
function run(name, fn) {
  try {
    fn();
    lines.push(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    lines.push(`  FAIL ${name}: ${error.message}`);
  }
}

const home = mkdtempSync(join(tmpdir(), 'cockpit-autoload-'));
const skillDir = join(home, 'skills', 'pdf');
mkdirSync(skillDir, { recursive: true });
const entry = join(skillDir, 'SKILL.md');
writeFileSync(
  entry,
  ['---', 'name: pdf', 'description: 处理 PDF：读取、合并、拆分、加水印', '---', '', '# PDF', '正文第一行', ''].join('\n'),
  'utf8',
);
clearBodyCache();

run('settings 默认关闭', () => {
  const s = readSettings(home);
  assert.equal(s.enabled, false);
  assert.equal(s.tier, 'standard');
});

run('settings 合并写入', () => {
  const a = writeSettings(home, { enabled: true, tier: 'strict' });
  assert.equal(a.enabled, true);
  assert.equal(a.tier, 'strict');
  const b = writeSettings(home, { perSkillOff: ['pdf'] });
  assert.equal(b.enabled, true, '合并写不能丢掉已开的开关');
  assert.equal(b.tier, 'strict');
  assert.deepEqual(b.perSkillOff, ['pdf']);
  const c = readSettings(home);
  assert.deepEqual(c.perSkillOff, ['pdf']);
  assert.ok(settingsPath(home).endsWith('autoload.json'));
});

run('settings 坏文件回落默认', () => {
  const bad = join(home, 'skill-cockpit', 'autoload.json');
  writeFileSync(bad, '{ not json', 'utf8');
  const s = readSettings(home);
  assert.equal(s.enabled, false);
});

run('frontmatter 剥离', () => {
  assert.equal(stripFrontmatter('---\nname: a\n---\n\n正文'), '\n正文');
  assert.equal(stripFrontmatter('没有头'), '没有头');
  assert.equal(stripFrontmatter(null), '');
});

run('正文读取 + mtime 缓存失效', () => {
  const body = readSkillBody(entry);
  assert.ok(body.includes('正文第一行'), '应读到正文');
  assert.ok(!body.includes('description:'), 'frontmatter 应被剥掉');
  // 改文件 + 改 mtime → 缓存必须失效
  writeFileSync(entry, '---\nname: pdf\n---\n\n改过的正文', 'utf8');
  const later = new Date(Date.now() + 5000);
  utimesSync(entry, later, later);
  const again = readSkillBody(entry);
  assert.ok(again.includes('改过的正文'), 'mtime 变了必须重读');
});

run('indexFromRows 去重 + 停用传递', () => {
  const rows = [
    { name: 'pdf', description: '处理 PDF', entryPath: entry, enabled: true },
    { name: 'pdf', description: '重复', entryPath: entry, enabled: true },
    { name: 'x', description: '', entryPath: join(home, 'nope.md'), enabled: false },
  ];
  const idx = indexFromRows(rows, { withBody: false });
  assert.equal(idx.length, 2, '同名只留一个');
  assert.equal(idx[1].enabled, false);
});

const skills = indexFromRows([{ name: 'pdf', description: '处理 PDF：读取、合并、拆分、加水印', entryPath: entry }]);
const messages = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: '把这个 PDF 拆成单页，再加个水印' },
];

run('关着不注入', () => {
  const off = planInjection({ messages, skills, settings: { enabled: false, tier: 'standard', budgetBytes: 24576, perSkillOff: [] } });
  assert.equal(off, null);
});

run('开着才注入，且不修改原数组', () => {
  const on = { enabled: true, tier: 'standard', budgetBytes: 24576, perSkillOff: [] };
  const plan = planInjection({ messages, skills, settings: on });
  assert.ok(plan, '应该产生注入');
  assert.ok(plan.picked.some((p) => p.name === 'pdf'));
  assert.equal(plan.messages.length, messages.length + 1);
  const injected = plan.messages[plan.messages.length - 1];
  assert.equal(injected.source.kind, SOURCE_KIND);
  assert.ok(injected.content.startsWith('<system-reminder>'));
  assert.ok(injected.content.includes('改过的正文'), '注入里要带技能正文');
  assert.equal(messages.length, 2, '入参数组不能被改');
});

run('去重：本会话已注入过就不再注入', () => {
  const on = { enabled: true, tier: 'standard', budgetBytes: 24576, perSkillOff: [] };
  const plan = planInjection({ messages, skills, settings: on, alreadyInjected: ['pdf'] });
  assert.equal(plan, null);
});

run('无关问题不注入', () => {
  const on = { enabled: true, tier: 'loose', budgetBytes: 24576, perSkillOff: [] };
  const plan = planInjection({
    messages: [{ role: 'user', content: '今天天气怎么样' }],
    skills,
    settings: on,
  });
  assert.equal(plan, null);
});

run('probe 落盘', () => {
  const file = writeProbe(home, { hello: 1 });
  assert.ok(file && file.endsWith('prestep-probe.json'));
});

rmSync(home, { recursive: true, force: true });
console.log(lines.join('\n'));
console.log(failures === 0 ? '\nautoload-wire: PASS' : `\nautoload-wire: FAIL ${failures}`);
process.exit(failures === 0 ? 0 : 1);
