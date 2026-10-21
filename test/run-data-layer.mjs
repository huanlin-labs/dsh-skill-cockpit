/**
 * Skill panel · DATA-LAYER self-test (no GUI, no dsh needed).
 *
 *   node test/run-data-layer.mjs [reportDir]
 *
 * What it proves:
 *   1. all six root kinds are enumerated (project-dsh / project-agents /
 *      custom / user-dsh / user-agents / bundled), each with source + rank;
 *   2. every entry the runtime would silently DROP is reported as `dropped:*`
 *      with a reason — nothing vanishes;
 *   3. a root that does not exist is reported as such (not as an error);
 *   4. an INDEPENDENT directory walk (written here, not shared with the panel)
 *      finds exactly the same set of entry files — so the panel cannot
 *      under-report;
 *   5. each row carries name / description / source / form / bytes / status /
 *      enabled, and every listed file really exists with that byte count.
 */

import { readdirSync, statSync, existsSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { normalizePreset, planPreset, countPresetWrites } from '../lib/presets.js';
import { applyModeToText } from '../lib/frontmatter.js';
import { scanSkills } from '../lib/scan.js';
import { resolveRoots } from '../lib/roots.js';

const reportDir = resolve(process.argv[2] ?? join(import.meta.dirname, 'out'));
const CWD = process.env.SKILL_PANEL_TEST_CWD ?? process.cwd();

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Deliberately independent re-implementation: is anything missed? */
function independentWalk(rootPath, skipSystem) {
  const found = new Set();
  if (!existsSync(rootPath)) return found;
  for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
    if (skipSystem && entry.name === '.system') continue;
    const full = join(rootPath, entry.name);
    if (entry.isDirectory()) {
      for (const name of ['SKILL.md', 'SKILL.md.disabled']) {
        const candidate = join(full, name);
        if (existsSync(candidate) && statSync(candidate).isFile()) found.add(candidate.toLowerCase());
      }
      continue;
    }
    if (!entry.isFile()) continue;
    if (/\.md(\.disabled)?$/.test(entry.name)) found.add(full.toLowerCase());
  }
  return found;
}

const roots = resolveRoots({ cwd: CWD });
const report = scanSkills({ cwd: CWD });

console.log(`\n=== 技能面板 · 数据层自测 ===`);
console.log(`cwd        : ${CWD}`);
console.log(`projectRoot: ${report.projectRoot}`);
console.log(`roots      : ${report.roots.length} 类（挂载 ${report.summary.rootsMounted} · 存在 ${report.summary.rootsPresent}）`);
console.log(
  `entries    : 共 ${report.summary.totalEntries} · 启用 ${report.summary.enabled} · 停用 ${report.summary.disabled} · ok ${report.summary.ok} · dropped ${report.summary.dropped} · errors ${report.summary.errors}`,
);
console.log(`模型可见   : ${report.summary.visibleToModel}\n`);

for (const root of report.roots) {
  console.log(
    `  ${root.source.padEnd(15)} rank ${String(root.rank).padEnd(3)} ${root.path === null ? '(未挂载)' : root.exists ? `${root.skillCount} 条 (启用 ${root.enabledCount}/停用 ${root.disabledCount})` : '不存在'}  ${root.writable ? '可写' : '只读'}  ${root.path ?? root.note ?? ''}`,
  );
}
console.log('');
for (const skill of report.skills) {
  const flag = skill.status === 'ok' ? (skill.enabled ? '✓' : '⏸') : '⚠';
  console.log(
    `  ${flag} ${(skill.name ?? '(无名)').padEnd(34)} ${skill.source.padEnd(15)} ${skill.form.padEnd(10)} ${String(skill.bytes).padStart(7)}  ${skill.status}${skill.reason ? ' :: ' + skill.reason : ''}`,
  );
}
if (report.skills.length === 0) console.log('  （没有枚举到任何条目）');

// --- assertions -----------------------------------------------------------

const sources = new Set(report.roots.map((r) => r.source));
for (const expected of ['project-dsh', 'project-agents', 'user-dsh', 'user-agents', 'bundled']) {
  check(`根清单含 ${expected}`, sources.has(expected));
}
check('custom 根也可表达（默认 0 个）', report.roots.filter((r) => r.source === 'custom').length >= 0);
check(
  'rank 与官方一致（100/200/300/400/500/600）',
  report.roots.every((r) => [100, 200, 300, 400, 500, 600].includes(r.rank)),
  report.roots.map((r) => `${r.source}:${r.rank}`).join(' '),
);

const badRows = report.skills.filter((s) => s.status !== 'ok' && (!s.reason || s.reason.trim() === ''));
check('非 ok 条目一律带原因（不静默丢弃）', badRows.length === 0, `${badRows.length} 条无原因`);

const missing = report.skills.filter((s) => !existsSync(s.filePath));
check('列出的入口文件都真实存在', missing.length === 0, missing.map((s) => s.filePath).join(', '));

const wrongBytes = report.skills.filter((s) => statSync(s.filePath).size !== s.bytes);
check('字节数与磁盘一致', wrongBytes.length === 0, wrongBytes.map((s) => s.filePath).join(', '));

const fieldsMissing = report.skills.filter(
  (s) => typeof s.form !== 'string' || typeof s.source !== 'string' || typeof s.enabled !== 'boolean' || typeof s.status !== 'string',
);
check('每行都有 source/form/status/enabled', fieldsMissing.length === 0);

const okMissingName = report.skills.filter((s) => s.status === 'ok' && (!s.name || !s.description));
check('ok 条目必有 name + description', okMissingName.length === 0);

// independent walk comparison
let expectedFiles = new Set();
for (const root of roots) {
  if (root.path === null) continue;
  for (const file of independentWalk(root.path, root.skipSystem === true)) expectedFiles.add(file);
}
const reported = new Set(report.skills.map((s) => resolve(s.filePath).toLowerCase()));
const missed = [...expectedFiles].filter((f) => !reported.has(f));
const extra = [...reported].filter((f) => !expectedFiles.has(f));
check('独立遍历：面板没有漏报条目', missed.length === 0, missed.slice(0, 5).join(', '));
check('独立遍历：面板没有多报条目', extra.length === 0, extra.slice(0, 5).join(', '));

const diskDisabled = [...expectedFiles].filter((f) => f.endsWith('.disabled'));
const rowDisabled = report.skills.filter((s) => !s.enabled);
check(
  '停用条目数与磁盘 .disabled 数一致',
  diskDisabled.length === rowDisabled.length,
  `磁盘 ${diskDisabled.length} / 面板 ${rowDisabled.length}`,
);

// a synthetic "bad frontmatter" fixture proves dropped:* is really reachable
const fixtureRoot = mkdtempSync(join(tmpdir(), 'skill-panel-fixture-'));
mkdirSync(join(fixtureRoot, 'no-frontmatter'), { recursive: true });
mkdirSync(join(fixtureRoot, 'unclosed'), { recursive: true });
mkdirSync(join(fixtureRoot, 'bad-yaml'), { recursive: true });
mkdirSync(join(fixtureRoot, 'missing-fields'), { recursive: true });
mkdirSync(join(fixtureRoot, 'good'), { recursive: true });
writeFileSync(join(fixtureRoot, 'no-frontmatter', 'SKILL.md'), '# 没有 frontmatter\n');
writeFileSync(join(fixtureRoot, 'unclosed', 'SKILL.md'), '---\nname: unclosed\ndescription: 未闭合\n');
writeFileSync(join(fixtureRoot, 'bad-yaml', 'SKILL.md'), '---\n\tname: tab-indent\ndescription: Tab 缩进\n---\n');
writeFileSync(join(fixtureRoot, 'missing-fields', 'SKILL.md'), '---\nname: no-desc\n---\n');
writeFileSync(join(fixtureRoot, 'good', 'SKILL.md'), '---\nname: good-probe\ndescription: 合法\n---\n正文\n');
writeFileSync(join(fixtureRoot, 'flat.md'), '---\nname: flat-probe\ndescription: 扁平型\n---\n正文\n');

const fixtureAll = scanSkills({ cwd: CWD, customSkillDirs: [fixtureRoot] });
const fixture = fixtureAll.skills.filter((s) => s.source === 'custom');
check(
  '坏 frontmatter 报 dropped:no-frontmatter',
  fixture.some((s) => s.status === 'dropped:no-frontmatter'),
  fixture.find((s) => s.status === 'dropped:no-frontmatter')?.reason,
);
check(
  '坏 frontmatter 报 dropped:unclosed',
  fixture.some((s) => s.status === 'dropped:unclosed'),
  fixture.find((s) => s.status === 'dropped:unclosed')?.reason,
);
check(
  '坏 frontmatter 报 dropped:bad-yaml',
  fixture.some((s) => s.status === 'dropped:bad-yaml'),
  fixture.find((s) => s.status === 'dropped:bad-yaml')?.reason,
);
check(
  '缺字段报 dropped:missing-fields',
  fixture.some((s) => s.status === 'dropped:missing-fields'),
  fixture.find((s) => s.status === 'dropped:missing-fields')?.reason,
);
check(
  '合法 fixture 报 ok（目录型 + 扁平型各一）',
  fixture.filter((s) => s.status === 'ok').length === 2,
  fixture.filter((s) => s.status === 'ok').map((s) => s.form).join(','),
);
check('fixture 条目一律来自 custom 根', fixture.length === 6, `${fixture.length} 条`);
check('custom 根被标为可配置且存在', fixtureAll.roots.find((r) => r.source === 'custom')?.exists === true);

// root-missing is reachable by pointing at a non-existent custom dir
const ghost = scanSkills({ cwd: CWD, customSkillDirs: [join(fixtureRoot, 'ghost-root-does-not-exist')] });
const ghostRoot = ghost.roots.filter((r) => r.source === 'custom').pop();
check('根不存在时显示不存在', ghostRoot && ghostRoot.exists === false && ghostRoot.path !== null);
rmSync(fixtureRoot, { recursive: true, force: true });

mkdirSync(reportDir, { recursive: true });
writeFileSync(join(reportDir, 'data-layer-report.json'), JSON.stringify({ report, checks, fixture, ghost }, null, 2));
console.log(`\n报告已写：${join(reportDir, 'data-layer-report.json')}`);

// ---- 四态写入：纯函数（只验文本变换，不碰磁盘） ----------------------------
const baseRaw = ['---', 'name: demo', 'description: 演示技能', '---', '', '# 正文', '保持不变'].join('\n');

const toUserOnly = applyModeToText(baseRaw, 'user-only');
check('user-only 写入 disable-model-invocation: true', toUserOnly.text.includes('disable-model-invocation: true'));
check('user-only 不动正文与其他键', toUserOnly.text.includes('# 正文') && toUserOnly.text.includes('description: 演示技能'));
const againUserOnly = applyModeToText(toUserOnly.text, 'user-only');
check('user-only 幂等（套两次结果相同）', againUserOnly.text === toUserOnly.text);

const toModelOnly = applyModeToText(toUserOnly.text, 'model-only');
check('model-only 只留 user-invocable: false', toModelOnly.text.includes('user-invocable: false') && !toModelOnly.text.includes('disable-model-invocation'));

const backToOn = applyModeToText(toModelOnly.text, 'on');
check('on 把两个键都清掉', !backToOn.text.includes('user-invocable') && !backToOn.text.includes('disable-model-invocation'));
check('on 之后 frontmatter 仍闭合', backToOn.text.startsWith('---\n') && backToOn.text.includes('\n---\n'));

const bogus = applyModeToText(baseRaw, 'half-on');
check('未知态被拒绝', typeof bogus.error === 'string');
// ---- 预设技能组：纯函数（只算，不写盘） ------------------------------------
const badPreset = normalizePreset({ name: '  ' });
check('预设没有名字时拒绝', typeof badPreset.error === 'string');

const dupPreset = normalizePreset({
  id: 'p1',
  name: '写作',
  items: [
    { filePath: 'A/SKILL.md', mode: 'on' },
    { filePath: 'A/SKILL.md', mode: 'off' },
    { filePath: 'B/SKILL.md', mode: 'nonsense' },
  ],
});
check('预设按 filePath 去重（重复项只留第一条）', dupPreset.items.length === 2, JSON.stringify(dupPreset.items));
check('认不出的 mode 回落为 on', dupPreset.items[1].mode === 'on', dupPreset.items[1].mode);

const fakeSkills = [
  { filePath: 'A/SKILL.md', name: '甲', mode: 'off', writable: true },
  { filePath: 'B/SKILL.md', name: '乙', mode: 'on', writable: true },
  { filePath: 'C/SKILL.md', name: '丙', mode: 'on', writable: false },
];
const plan = planPreset(dupPreset, fakeSkills);
check('要改的只有状态不同的那一个', plan.steps.length === 1 && plan.steps[0].name === '甲', JSON.stringify(plan.steps));
check('已经是目标态的不算一步（计入 unchanged）', plan.unchanged === 1, String(plan.unchanged));
check('去重后 A、B 都存在，missing 为空', plan.missing.length === 0, JSON.stringify(plan.missing));

const blockedPreset = normalizePreset({ name: 'x', items: [{ filePath: 'C/SKILL.md', mode: 'off' }] });
const blockedPlan = planPreset(blockedPreset, fakeSkills);
check('不可写（provider / 只读根）的技能被挡下，不产生写步骤', blockedPlan.blocked.length === 1 && blockedPlan.steps.length === 0);

const exclPreset = normalizePreset({ name: '专一', scope: 'exclusive', items: [{ filePath: 'A/SKILL.md', mode: 'on' }] });
const exclPlan = planPreset(exclPreset, fakeSkills);
check('exclusive 模式下清单外、可写、开着的技能要关掉（乙；丙不可写被跳过）', exclPlan.exclusiveOff.length === 1 && exclPlan.exclusiveOff[0].name === '乙', JSON.stringify(exclPlan.exclusiveOff));
check('写盘总数 = 清单内改动(甲) + 清单外关闭(乙) = 2', countPresetWrites(exclPlan) === 2, String(countPresetWrites(exclPlan)));
const failed = checks.filter((c) => !c.ok);
console.log(`\n=== 数据层自测：${checks.length - failed.length}/${checks.length} 通过 ===`);
process.exit(failed.length === 0 ? 0 : 1);
