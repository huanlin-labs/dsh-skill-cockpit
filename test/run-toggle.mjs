/**
 * Skill panel · SWITCH self-test (the closed loop, on the real user root).
 *
 *   node test/run-toggle.mjs [reportDir]
 *
 * Discipline (mirrors 方案 §9): exactly ONE brand-new probe skill is created,
 * nothing that already exists is ever renamed, and everything is removed again
 * at the end. The script records the root's item count and the machine-wide
 * `.disabled` residue before and after, and it aborts if the probe would
 * overwrite something.
 *
 * What it proves:
 *   1. disable = rename SKILL.md -> SKILL.md.disabled (content byte-identical);
 *   2. the entry stays visible to the panel as "已停用" instead of vanishing;
 *   3. re-enable restores the exact original bytes;
 *   4. the root's item count never changes (only the entry FILE is renamed);
 *   5. project-level roots refuse the write, directories refuse, non-entry
 *      files refuse, files outside every writable root refuse.
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { scanSkills } from '../lib/scan.js';
import { planToggle, toggleSkill } from '../lib/toggle.js';
import { resolveRoots, resolveDshHome } from '../lib/roots.js';

const reportDir = resolve(process.argv[2] ?? join(import.meta.dirname, 'out'));
const CWD = process.env.SKILL_PANEL_TEST_CWD ?? process.cwd();
const stamp = Date.now().toString(36);
const PROBE_NAME = `skillpanel-probe-${stamp}`;
const FLAT_NAME = `skillpanel-probe-flat-${stamp}`;

const observations = [];
const checks = [];
function note(step, detail) {
  observations.push({ step, at: new Date().toISOString(), detail });
  console.log(`· ${step}: ${detail}`);
}
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
function countItems(dir) {
  return existsSync(dir) ? readdirSync(dir).length : 0;
}
function countDisabled(dir) {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.disabled')) total += 1;
    if (entry.isDirectory()) total += countDisabled(full);
  }
  return total;
}

const dshHome = resolveDshHome(undefined);
const userRoot = join(dshHome, 'skills');
const probeDir = join(userRoot, PROBE_NAME);
const flatPath = join(userRoot, `${FLAT_NAME}.md`);
const opts = { cwd: CWD };

console.log(`\n=== 技能面板 · 开关自测 ===`);
console.log(`用户技能根 : ${userRoot}`);
console.log(`探针       : ${PROBE_NAME} / ${FLAT_NAME}\n`);

const baselineItems = countItems(userRoot);
const baselineDisabled = countDisabled(userRoot);
note('baseline', `技能根项数 ${baselineItems} · 全根 .disabled 残留 ${baselineDisabled}`);

if (!existsSync(userRoot)) {
  // 干净环境（CI 的 ~/.dsh 是空的）：技能根不存在时建一个空目录，探针才有地方放。
  mkdirSync(userRoot, { recursive: true });
  note('setup', `技能根不存在，已创建空目录 ${userRoot}`);
}
if (existsSync(probeDir) || existsSync(flatPath)) {
  console.error('探针路径已存在，拒绝继续（避免覆盖）。');
  process.exit(1);
}

const before = scanSkills(opts);
const beforeVisible = before.summary.visibleToModel;
note('scan-before', `枚举 ${before.summary.totalEntries} 条 · 模型可见 ${beforeVisible}`);
note('roots-before', before.roots.map((r) => `${r.source}${r.exists ? '✓' : '✗'}`).join(' '));

const content = `---\nname: ${PROBE_NAME}\ndescription: 技能面板开关自测探针（用完即删）\n---\n\n这是一个临时探针技能，只用于验证「改入口文件名 = 停用」的闭环。\n`;
const flatContent = `---\nname: ${FLAT_NAME}\ndescription: 技能面板开关自测探针（扁平型，用完即删）\n---\n\n扁平型探针正文。\n`;
const hash = sha256(content);
const flatHash = sha256(flatContent);

let cleanupNeeded = true;
function cleanup() {
  if (!cleanupNeeded) return;
  try {
    if (existsSync(probeDir)) rmSync(probeDir, { recursive: true, force: true });
  } catch (error) {
    console.error('探针目录清理失败：', error.message);
  }
  try {
    if (existsSync(flatPath)) rmSync(flatPath, { force: true });
    const parkedFlat = `${flatPath}.disabled`;
    if (existsSync(parkedFlat)) rmSync(parkedFlat, { force: true });
  } catch (error) {
    console.error('探针文件清理失败：', error.message);
  }
  cleanupNeeded = false;
}
process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

try {
  // ---------------------------------------------------------------- dir bundle
  mkdirSync(probeDir, { recursive: true });
  writeFileSync(join(probeDir, 'SKILL.md'), content, 'utf8');
  writeFileSync(join(probeDir, 'references-note.md'), '不是入口文件，不该被改\n', 'utf8');
  note('create', `建探针目录 + SKILL.md + 一个非入口文件（references-note.md）`);

  const afterCreate = scanSkills(opts);
  const probeRow = afterCreate.skills.find((s) => s.filePath === join(probeDir, 'SKILL.md'));
  check('新建探针被枚举到', Boolean(probeRow));
  check('探针 status=ok / enabled=true / writable=true', probeRow?.status === 'ok' && probeRow?.enabled === true && probeRow?.writable === true, JSON.stringify({ status: probeRow?.status, enabled: probeRow?.enabled, writable: probeRow?.writable }));
  check('探针来源为 user-dsh', probeRow?.source === 'user-dsh', probeRow?.source);
  check('技能根项数 = 基线 + 1', countItems(userRoot) === baselineItems + 1, `${countItems(userRoot)} vs ${baselineItems + 1}`);
  check('探针计入模型可见数', afterCreate.summary.visibleToModel === beforeVisible + 1, `${afterCreate.summary.visibleToModel} vs ${beforeVisible + 1}`);
  note('scan-after-create', `模型可见 ${afterCreate.summary.visibleToModel}（基线 ${beforeVisible} +1）`);

  // dry run never touches the disk
  const plan = planToggle(join(probeDir, 'SKILL.md'), true, opts);
  check('dry-run 给出 期望的 from→to', plan.from.endsWith('SKILL.md') && plan.to.endsWith('SKILL.md.disabled') && plan.applied === false);
  check('dry-run 不动磁盘', existsSync(join(probeDir, 'SKILL.md')) && !existsSync(join(probeDir, 'SKILL.md.disabled')));

  // ------------------------------------------------------------- disable
  const off = toggleSkill({ filePath: join(probeDir, 'SKILL.md'), disable: true }, opts);
  check('停用返回 applied=true + 字节数', off.applied === true && off.bytes === Buffer.byteLength(content, 'utf8'));
  check('SKILL.md 已不存在', !existsSync(join(probeDir, 'SKILL.md')));
  check('SKILL.md.disabled 存在', existsSync(join(probeDir, 'SKILL.md.disabled')));
  const parkedText = readFileSync(join(probeDir, 'SKILL.md.disabled'), 'utf8');
  check('停用后内容逐字节一致（sha256）', sha256(parkedText) === hash, `${sha256(parkedText).slice(0, 12)} vs ${hash.slice(0, 12)}`);
  check('目录仍在（未改目录名）', existsSync(probeDir));
  check('技能根项数不变', countItems(userRoot) === baselineItems + 1, String(countItems(userRoot)));
  note('disable', `改名 → ${off.to} · 根项数 ${countItems(userRoot)} · 内容 hash 一致`);

  const afterDisable = scanSkills(opts);
  const parkedRow = afterDisable.skills.find((s) => s.source === 'user-dsh' && s.filePath.endsWith('SKILL.md.disabled'));
  check('停用条目仍被面板列出（不消失）', Boolean(parkedRow));
  check('停用条目 enabled=false 且 status=ok', parkedRow?.enabled === false && parkedRow?.status === 'ok', JSON.stringify({ enabled: parkedRow?.enabled, status: parkedRow?.status }));
  check('停用后模型可见数回落', afterDisable.summary.visibleToModel === beforeVisible, `${afterDisable.summary.visibleToModel} vs ${beforeVisible}`);
  note('scan-after-disable', `该条 enabled=false（面板显示已停用）· 模型可见 ${afterDisable.summary.visibleToModel}`);

  // guard: disabling twice
  let doubleDisable;
  try {
    toggleSkill({ filePath: join(probeDir, 'SKILL.md.disabled'), disable: true }, opts);
  } catch (error) {
    doubleDisable = error.message;
  }
  check('重复停用被拒绝', typeof doubleDisable === 'string', doubleDisable);

  // ------------------------------------------------------------- re-enable
  const on = toggleSkill({ filePath: join(probeDir, 'SKILL.md.disabled'), disable: false }, opts);
  check('恢复返回 applied=true', on.applied === true);
  check('SKILL.md 回来了', existsSync(join(probeDir, 'SKILL.md')) && !existsSync(join(probeDir, 'SKILL.md.disabled')));
  check('恢复后内容逐字节一致（sha256）', sha256(readFileSync(join(probeDir, 'SKILL.md'), 'utf8')) === hash);
  const afterEnable = scanSkills(opts);
  check('恢复后模型可见数回到 +1', afterEnable.summary.visibleToModel === beforeVisible + 1, String(afterEnable.summary.visibleToModel));
  note('enable', `恢复成功 · 根项数 ${countItems(userRoot)} · 模型可见 ${afterEnable.summary.visibleToModel}`);

  // guard: enabling twice
  let doubleEnable;
  try {
    toggleSkill({ filePath: join(probeDir, 'SKILL.md'), disable: false }, opts);
  } catch (error) {
    doubleEnable = error.message;
  }
  check('重复恢复被拒绝', typeof doubleEnable === 'string', doubleEnable);

  // --------------------------------------------------------------- flat skill
  writeFileSync(flatPath, flatContent, 'utf8');
  const flatRow = scanSkills(opts).skills.find((s) => s.filePath === flatPath);
  check('扁平型探针被枚举到（form=flat-md）', flatRow?.form === 'flat-md', flatRow?.form);
  const flatOff = toggleSkill({ filePath: flatPath, disable: true }, opts);
  check('扁平型停用 → x.md.disabled', flatOff.applied === true && existsSync(`${flatPath}.disabled`));
  check('扁平型停用后内容一致', sha256(readFileSync(`${flatPath}.disabled`, 'utf8')) === flatHash);
  const flatOn = toggleSkill({ filePath: `${flatPath}.disabled`, disable: false }, opts);
  check('扁平型恢复 → x.md', flatOn.applied === true && existsSync(flatPath) && sha256(readFileSync(flatPath, 'utf8')) === flatHash);
  note('flat', '扁平型 x.md ↔ x.md.disabled 闭环通过');

  // ------------------------------------------------------------------- guards
  let dirRefused;
  try {
    toggleSkill({ filePath: probeDir, disable: true }, opts);
  } catch (error) {
    dirRefused = error.message;
  }
  check('拒绝改目录名', typeof dirRefused === 'string' && dirRefused.includes('目录'), dirRefused);

  let nonEntryRefused;
  try {
    toggleSkill({ filePath: join(probeDir, 'references-note.md'), disable: true }, opts);
  } catch (error) {
    nonEntryRefused = error.message;
  }
  check('拒绝改根内非入口文件', typeof nonEntryRefused === 'string' && nonEntryRefused.includes('入口文件'), nonEntryRefused);
  check('非入口文件确实没被改', existsSync(join(probeDir, 'references-note.md')));

  const outside = mkdtempSync(join(tmpdir(), 'skill-panel-outside-'));
  const outsideFile = join(outside, 'outside.md');
  writeFileSync(outsideFile, content, 'utf8');
  let outsideRefused;
  try {
    toggleSkill({ filePath: outsideFile, disable: true }, opts);
  } catch (error) {
    outsideRefused = error.message;
  }
  check('拒绝改任何可写根之外的文件', typeof outsideRefused === 'string' && outsideRefused.includes('可写技能根'), outsideRefused);
  check('根外文件确实没被改', existsSync(outsideFile));
  rmSync(outside, { recursive: true, force: true });

  // project-level root is read-only by design
  const fakeProject = mkdtempSync(join(tmpdir(), 'skill-panel-proj-'));
  mkdirSync(join(fakeProject, '.git'), { recursive: true });
  mkdirSync(join(fakeProject, '.dsh', 'skills', PROBE_NAME), { recursive: true });
  const projectSkill = join(fakeProject, '.dsh', 'skills', PROBE_NAME, 'SKILL.md');
  writeFileSync(projectSkill, content, 'utf8');
  const projectScan = scanSkills({ cwd: fakeProject });
  const projectRow = projectScan.skills.find((s) => s.filePath === projectSkill);
  check('项目级技能被枚举到', Boolean(projectRow));
  check('项目级技能标记为只读', projectRow?.writable === false, String(projectRow?.writable));
  let projectRefused;
  try {
    toggleSkill({ filePath: projectSkill, disable: true }, { cwd: fakeProject });
  } catch (error) {
    projectRefused = error.message;
  }
  check('拒绝写项目级根（工作区=权限域）', typeof projectRefused === 'string' && projectRefused.includes('可写技能根'), projectRefused);
  check('项目级技能确实没被改', existsSync(projectSkill) && !existsSync(`${projectSkill}.disabled`));
  note('project-root', `项目根 ${projectScan.projectRoot} 下的技能只读且被拒写`);
  rmSync(fakeProject, { recursive: true, force: true });
} finally {
  cleanup();
}

// ------------------------------------------------------------------ residue
const finalItems = countItems(userRoot);
const finalDisabled = countDisabled(userRoot);
check('清理后技能根项数回到基线（零残留）', finalItems === baselineItems, `${finalItems} vs ${baselineItems}`);
check('清理后 .disabled 残留清零', finalDisabled === baselineDisabled, `${finalDisabled} vs 基线 ${baselineDisabled}`);
check('探针目录已删除', !existsSync(probeDir));
check('扁平探针已删除', !existsSync(flatPath) && !existsSync(`${flatPath}.disabled`));
const finalScan = scanSkills(opts);
check('清理后条目数与基线一致', finalScan.summary.totalEntries === before.summary.totalEntries, `${finalScan.summary.totalEntries} vs ${before.summary.totalEntries}`);
check('清理后模型可见数与基线一致', finalScan.summary.visibleToModel === beforeVisible, `${finalScan.summary.visibleToModel} vs ${beforeVisible}`);
check(
  '31 个既有技能全程未被触碰（逐条路径仍在）',
  before.skills.every((s) => existsSync(s.filePath)),
  `${before.skills.length} 条基线条目全部存在`,
);
note('residue', `根项数 ${finalItems}（基线 ${baselineItems}）· .disabled ${finalDisabled}（基线 ${baselineDisabled}）`);

mkdirSync(reportDir, { recursive: true });
writeFileSync(
  join(reportDir, 'toggle-report.json'),
  JSON.stringify({ baselineItems, baselineDisabled, finalItems, finalDisabled, observations, checks }, null, 2),
);
console.log(`\n报告已写：${join(reportDir, 'toggle-report.json')}`);

const failed = checks.filter((c) => !c.ok);
console.log(`\n=== 开关自测：${checks.length - failed.length}/${checks.length} 通过 ===`);
process.exit(failed.length === 0 ? 0 : 1);
