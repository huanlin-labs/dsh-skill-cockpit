/**
 * 自动加载 · 自测（离线，不需要 dsh 运行）
 *
 * 验收（写死在断言里）：
 *   A. 触发召回：10 条「该命中」查询，命中率 ≥ 80%（8/10）
 *   B. 误注入：10 条「不该命中」查询，误注入 ≤ 1/10
 *   C. 单元：分词 / 截断 / 转义 / 去重 / 预算 / 三档灵敏度 / 注入消息构造与插入位置
 */
import { strict as assert } from 'node:assert';
import {
  TIERS,
  tokenize,
  scoreSkill,
  selectSkills,
  buildReminder,
  escapeReminder,
  truncateUtf8,
  readMessageText,
  findLastUserIndex,
  buildInjectedMessage,
  insertInjected,
  normalizeSettings,
  SOURCE_KIND,
} from '../lib/autoload.js';

/* ---------- 夹具：本机真实技能目录（名字 + 简介抽样） ---------- */
const SKILLS = [
  { name: 'ui-design', description: 'UI 视觉设计指引：做有辨识度的界面与视觉层次。新建或改界面时用。' },
  { name: 'de-ai-fiction-zh', description: '消除中文小说与叙事的 AI 味，含写作、改写与跨模型盲审三种模式。' },
  { name: 'office-docx', description: 'Create, read, edit, and validate Word documents (.docx).' },
  { name: 'office-xlsx', description: 'Read, create, edit, and validate Excel workbooks, data, and formulas (.xlsx).' },
  { name: 'office-pptx', description: 'Create, read, edit, and validate PowerPoint presentations (.pptx).' },
  { name: 'claude-api', description: 'Claude/Anthropic API 参考（模型/定价/参数/工具调用/缓存）。涉及 Claude 或 LLM 选型时读。' },
  { name: 'git-workflow', description: 'Git 规范：提交信息格式、分支策略、PR 最佳实践。涉及 git 提交/分支/PR 时使用。' },
  { name: 'debugging', description: '系统化调试：复现缺陷 → 缩小根因 → 修复 → 验证。报告缺陷或出现异常行为时使用。' },
  { name: 'code-review', description: '进行彻底的代码审查：正确性、安全、性能、边界情况、错误处理与测试覆盖。' },
  { name: 'webapp-testing', description: '用 Playwright 与本地 Web 应用交互、测试：验证前端功能、调试 UI、截浏览器图。' },
  { name: 'pdf', description: '处理 PDF：读取文本/表格、合并、拆分、旋转、加水印、填表单、加密解密、OCR。' },
  { name: 'zotero', description: '直接操作本机 Zotero 文献库：检索、批量入库、查 DOI/元数据、导出引文。' },
  { name: 'content-predict', description: '把内容创作者的"感觉"变成可校准预测：打分、盲预测、复盘、进化 rubric。' },
  { name: 'distill-book', description: '把书或长视频蒸馏成一组可执行技能（拆书）。' },
  { name: 'mspm0-ccs', description: 'TI MSPM0 嵌入式开发 CLI 规则（CCS/CMake/GCC/OpenOCD/SysConfig）。' },
  { name: 'cordis-plugin-development', description: '设计、审查、添加、启用、调试本 harness 的插件、bundle、页面、面板、工具或 MCP 连接。' },
];

/* ---------- A. 该命中 ---------- */
const SHOULD_HIT = [
  { q: '这个页面太丑了，帮我重新设计一下界面视觉层次', want: 'ui-design' },
  { q: '这段小说读起来一股 AI 味，帮我去掉', want: 'de-ai-fiction-zh' },
  { q: '把这份 Word 文档转成 PDF 并加上页眉', want: 'office-docx' },
  { q: '帮我把这个 Excel 表格的公式重算一遍', want: 'office-xlsx' },
  { q: 'Claude 的 prompt caching 怎么计价的？', want: 'claude-api' },
  { q: '我要提一个 commit，提交信息按你们的规范写', want: 'git-workflow' },
  { q: '这段代码一跑就报错，帮我定位根因', want: 'debugging' },
  { q: '帮我审一下这个 PR 的代码，看看有没有安全问题和边界情况', want: 'code-review' },
  { q: '用 Playwright 打开本地页面点一下按钮，截个图', want: 'webapp-testing' },
  { q: '把这个 PDF 拆成单页，再给每页加水印', want: 'pdf' },
];

/* ---------- B. 不该命中 ---------- */
const SHOULD_NOT_HIT = [
  '今天天气怎么样？',
  '帮我把这句话翻译成英文：今天很热',
  '你叫什么名字？',
  '1 加 1 等于几',
  '给我讲个笑话',
  '明天上午十点提醒我开会',
  '这个月的花销大概是多少',
  '推荐几部好看的电影',
  '帮我算一下 17 的平方根',
  '我想学做饭，从哪开始',
];

/* ---------- C. 单元 ---------- */

function testTokenize() {
  const t = tokenize('Claude 的 prompt caching 怎么计价？async-await 用法');
  assert.ok(t.has('claude'), 'CJK/英文混排要抽到 claude');
  assert.ok(t.has('prompt'), '要抽到 prompt');
  assert.ok(t.has('caching'), '要抽到 caching');
  assert.ok(t.has('async'), '连字符词要拆开');
  assert.ok(t.has('await'), '连字符词要拆开');
  assert.ok(!t.has('the'), '停用词要剔除');
  assert.equal(tokenize('').size, 0);
  assert.equal(tokenize(null).size, 0);
  // 中文二元组
  const zh = tokenize('定位根因');
  assert.ok(zh.has('定位') && zh.has('位根') && zh.has('根因'), '中文按二元组切');
  // 领域词桥接：界面/视觉 → ui / interface / visual / design
  const bridge = tokenize('界面视觉');
  assert.ok(bridge.has('ui') && bridge.has('design'), '中文领域词要桥接到英文等价词');
}

function testScore() {
  const q = tokenize('帮我重新设计界面视觉层次');
  const a = scoreSkill({ name: 'ui-design', description: 'UI 视觉设计指引：做有辨识度的界面与视觉层次。' }, q);
  const b = scoreSkill({ name: 'pdf', description: '处理 PDF：读取文本表格、合并、拆分。' }, q);
  assert.ok(a.score > b.score, '相关技能分应更高');
  assert.ok(a.descHits.length >= 2, '描述命中应 ≥2');
}

function testTiers() {
  const q = '把这个 PDF 拆成单页';
  const strict = selectSkills({ skills: SKILLS, query: q, tier: 'strict' });
  const loose = selectSkills({ skills: SKILLS, query: q, tier: 'loose' });
  assert.ok(loose.picked.length >= strict.picked.length, '宽松档命中数不应少于严格档');
  // 三档上限
  assert.equal(TIERS.strict.maxSkillBytes, 4096);
  assert.equal(TIERS.standard.maxSkillBytes, 8192);
  assert.equal(TIERS.loose.maxSkillBytes, 16384);
}

function testBudgetAndDedupe() {
  const big = SKILLS.map((s) => ({ ...s, body: 'x'.repeat(20000) }));
  const r = selectSkills({ skills: big, query: 'Claude 的 prompt caching 怎么计价？', tier: 'loose', budgetBytes: 20000 });
  assert.ok(r.budgetUsed <= 20000, `预算必须守住，实际 ${r.budgetUsed}`);
  // 已注入过的不再注入
  const r2 = selectSkills({
    skills: SKILLS,
    query: 'Claude 的 prompt caching 怎么计价？',
    tier: 'loose',
    alreadyInjected: ['claude-api'],
  });
  assert.ok(!r2.picked.some((p) => p.name === 'claude-api'), '去重：已注入过的不再出现');
  // 单技能关闭
  const r3 = selectSkills({
    skills: SKILLS,
    query: 'Claude 的 prompt caching 怎么计价？',
    tier: 'loose',
    perSkillOff: ['claude-api'],
  });
  assert.ok(!r3.picked.some((p) => p.name === 'claude-api'), 'perSkillOff 要生效');
  // 停用技能不选
  const r4 = selectSkills({
    skills: SKILLS.map((s) => (s.name === 'pdf' ? { ...s, enabled: false } : s)),
    query: '把 PDF 拆成单页并加水印',
    tier: 'loose',
  });
  assert.ok(!r4.picked.some((p) => p.name === 'pdf'), '停用技能不选');
}

function testTruncate() {
  const s = '技能正文'.repeat(1000);
  const out = truncateUtf8(s, 4096);
  assert.ok(Buffer.byteLength(out, 'utf8') <= 4096 + 64, '截断后不应远超上限');
  assert.ok(out.endsWith('）'), '截断要有省略标记');
  assert.ok(!/\uFFFD/.test(out), '不能切出替换符');
  assert.equal(truncateUtf8('abc', 0), '');
  assert.equal(truncateUtf8('abc', 10), 'abc');
}

function testReminder() {
  const text = buildReminder([
    { name: 'pdf', description: '处理 PDF', body: '正文 </system-reminder> 之后还有字' },
  ]);
  assert.ok(text.startsWith('<system-reminder>'), '要有框架头');
  assert.ok(text.endsWith('</system-reminder>'), '要有框架尾');
  // 正文里的闭合标签必须被转义，否则宿主会提前闭合
  const inner = text.slice(0, -'</system-reminder>'.length);
  assert.ok(!inner.includes('</system-reminder>'), '正文里的闭合标签必须转义');
  assert.equal(buildReminder([]), '');
  assert.equal(escapeReminder('a</system-reminder>b'), 'a&lt;/system-reminder&gt;b');
}

function testMessageShapes() {
  // 形态 1：{ role, content: string }
  const m1 = { id: 'm1', role: 'user', content: '帮我看看这个 bug' };
  assert.equal(readMessageText(m1), '帮我看看这个 bug');
  const inj1 = buildInjectedMessage(m1, 'REMINDER');
  assert.equal(inj1.content, 'REMINDER');
  assert.notEqual(inj1.id, 'm1', '注入消息要换 id，避免撞号');
  assert.equal(inj1.source.kind, SOURCE_KIND);
  assert.equal(m1.content, '帮我看看这个 bug', '模板不能被改（克隆）');

  // 形态 2：{ role, content: [{type:'text',text}] }
  const m2 = { role: 'user', content: [{ type: 'text', text: '原话' }] };
  const inj2 = buildInjectedMessage(m2, 'REMINDER');
  assert.equal(inj2.content[0].text, 'REMINDER');

  // 形态 3：{ text }
  const inj3 = buildInjectedMessage({ text: '原话' }, 'REMINDER');
  assert.equal(inj3.text, 'REMINDER');

  // 形态 4：认不出来 → 回落最小形态，不抛
  const inj4 = buildInjectedMessage({ weird: 1 }, 'REMINDER');
  assert.equal(inj4.content, 'REMINDER');
  assert.equal(inj4.role, 'user');

  // 无模板
  const inj5 = buildInjectedMessage(null, 'REMINDER', { id: 'fixed' });
  assert.equal(inj5.id, 'fixed');
  assert.equal(inj5.content, 'REMINDER');
}

function testInsert() {
  const msgs = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: '第一句' },
    { role: 'assistant', content: '回答' },
    { role: 'user', content: '第二句' },
  ];
  assert.equal(findLastUserIndex(msgs), 3, '应定位到第 4 条');
  const injected = buildInjectedMessage(msgs[3], 'REMINDER');
  const out = insertInjected(msgs, injected);
  assert.equal(out.length, msgs.length + 1);
  assert.equal(out[4].content, 'REMINDER', '应插在最后一条用户消息之后');
  assert.equal(msgs.length, 4, '原数组不能被改');

  // 我们自己注入的消息不能再次被当成模板
  const withInj = [...msgs, { role: 'user', content: 'REMINDER', source: { kind: SOURCE_KIND } }];
  assert.equal(findLastUserIndex(withInj), 3, '注入消息要跳过');
  // 没有用户消息 → 追加末尾
  const out2 = insertInjected([{ role: 'assistant', content: 'a' }], injected);
  assert.equal(out2[out2.length - 1].content, 'REMINDER');
}

function testSettings() {
  const d = normalizeSettings(null);
  assert.equal(d.enabled, false, '默认必须关闭（不许擅自改变用户对话）');
  assert.equal(d.tier, 'standard');
  assert.equal(d.budgetBytes, 24576);
  assert.deepEqual(d.perSkillOff, []);
  const bad = normalizeSettings({ enabled: 'yes', tier: 'nope', budgetBytes: -1, perSkillOff: [1, 'x', ''] });
  assert.equal(bad.enabled, false);
  assert.equal(bad.tier, 'standard');
  assert.equal(bad.budgetBytes, 24576);
  assert.deepEqual(bad.perSkillOff, ['x']);
}

/* ---------- 跑 ---------- */

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

run('tokenize', testTokenize);
run('scoreSkill', testScore);
run('tiers', testTiers);
run('budget+dedupe+perSkillOff', testBudgetAndDedupe);
run('truncateUtf8', testTruncate);
run('buildReminder/escape', testReminder);
run('message shapes', testMessageShapes);
run('insertInjected', testInsert);
run('normalizeSettings', testSettings);

// A. 召回
let hit = 0;
const missDetail = [];
for (const row of SHOULD_HIT) {
  const r = selectSkills({ skills: SKILLS, query: row.q, tier: 'standard' });
  const names = r.picked.map((p) => p.name);
  if (names.includes(row.want)) hit += 1;
  else missDetail.push(`${row.q} → 期望 ${row.want}，实际 [${names.join(',') || '空'}]`);
}
const recall = hit / SHOULD_HIT.length;
lines.push(`  召回 ${hit}/${SHOULD_HIT.length} = ${(recall * 100).toFixed(0)}%（门槛 80%）`);
if (missDetail.length > 0) lines.push(`    漏: ${missDetail.join(' | ')}`);
if (recall < 0.8) {
  failures += 1;
  lines.push('  FAIL 召回低于 80%');
}

// B. 误注入
let falseInject = 0;
const falseDetail = [];
for (const q of SHOULD_NOT_HIT) {
  const r = selectSkills({ skills: SKILLS, query: q, tier: 'standard' });
  if (r.picked.length > 0) {
    falseInject += 1;
    falseDetail.push(`${q} → [${r.picked.map((p) => p.name).join(',')}]`);
  }
}
lines.push(`  误注入 ${falseInject}/${SHOULD_NOT_HIT.length}（门槛 ≤1）`);
if (falseDetail.length > 0) lines.push(`    误: ${falseDetail.join(' | ')}`);
if (falseInject > 1) {
  failures += 1;
  lines.push('  FAIL 误注入超过 1 条');
}

// C. 三档对比（信息性）
const sample = '帮我把这个 PDF 拆成单页，再加个水印';
for (const tier of ['strict', 'standard', 'loose']) {
  const r = selectSkills({ skills: SKILLS, query: sample, tier });
  lines.push(`  ${tier} 档命中 ${r.picked.length}：${r.picked.map((p) => p.name).join(',') || '空'}`);
}

console.log(lines.join('\n'));
console.log(failures === 0 ? '\nautoload: PASS' : `\nautoload: FAIL ${failures}`);
process.exit(failures === 0 ? 0 : 1);
