/**
 * Skill panel · lib/checks.js self-test (pure functions, no disk).
 *
 *   node test/run-checks.mjs [reportDir]
 *
 * lib/checks.js takes the /skills scan report and reports four classes of
 * "loads fine but earns nothing" problems. The report shape is pinned by
 * lib/scan.js, so the fixtures here are literal scan-report rows — no host, no
 * real skill directory, no filesystem.
 *
 * Covered, per class, both directions:
 *   shadowed            跨根重名被遮蔽
 *   short-description   描述为空或过短（< 20 字）
 *   dir-name-mismatch   目录名 ≠ frontmatter name（仅 dir-bundle）
 *   empty-body          正文疑似为空（按文件字节估计）
 * plus: 汇总计数 / 阈值可覆盖 / 畸形输入不抛 / 同技能同类别不重复 / 稳定顺序。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  analyzeSkills,
  CHECK_KINDS,
  CHECK_LABELS,
  EMPTY_BODY_BYTES,
  MIN_DESCRIPTION_LENGTH,
} from '../lib/checks.js';

const reportDir = resolve(process.argv[2] ?? join(import.meta.dirname, 'out'));
const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

// ---- fixture builders -----------------------------------------------------

/**
 * A healthy dir-bundle row: long description, name matches its directory.
 * The paths are derived from `name` so that overriding only the name cannot
 * accidentally create a dir-name mismatch (that is a separate, explicit case).
 */
function goodSkill(overrides = {}) {
  const name = typeof overrides.name === 'string' && overrides.name !== '' ? overrides.name : 'canvas-design';
  const dir = `C:\\Users\\x\\.dsh\\skills\\${name}`;
  return {
    name,
    description: '用代码直接生成 PNG/PDF 视觉设计稿，不依赖外部应用',
    source: 'user-dsh',
    rank: 400,
    rootPath: 'C:\\Users\\x\\.dsh\\skills',
    form: 'dir-bundle',
    entryName: 'SKILL.md',
    enabledName: 'SKILL.md',
    filePath: `${dir}\\SKILL.md`,
    entryPath: dir,
    relEntry: name,
    enabled: true,
    writable: true,
    bytes: 1629,
    status: 'ok',
    reason: undefined,
    ...overrides,
  };
}

function report(skills) {
  return {
    generatedAt: '2026-10-20T00:00:00.000Z',
    cwd: null,
    roots: [],
    skills,
    summary: { totalEntries: skills.length, enabled: 0, visibleToModel: 0 },
  };
}

const kindsOf = (result) => result.checks.map((row) => row.kind);
const countKind = (result, kind) => result.checks.filter((row) => row.kind === kind).length;

// ---- 0. 常量与标签 -------------------------------------------------------

check('导出 MIN_DESCRIPTION_LENGTH = 20', MIN_DESCRIPTION_LENGTH === 20, String(MIN_DESCRIPTION_LENGTH));
check('导出 EMPTY_BODY_BYTES = 300', EMPTY_BODY_BYTES === 300, String(EMPTY_BODY_BYTES));
check(
  '四类机器名齐全',
  CHECK_KINDS.shadowed === 'shadowed' &&
    CHECK_KINDS.shortDescription === 'short-description' &&
    CHECK_KINDS.dirNameMismatch === 'dir-name-mismatch' &&
    CHECK_KINDS.emptyBody === 'empty-body',
  JSON.stringify(CHECK_KINDS),
);
check(
  '四类中文标签齐全',
  CHECK_LABELS['shadowed'] === '跨根重名被遮蔽' &&
    CHECK_LABELS['short-description'] === '描述为空或过短' &&
    CHECK_LABELS['dir-name-mismatch'] === '目录名≠技能名' &&
    CHECK_LABELS['empty-body'] === '正文疑似为空',
  JSON.stringify(CHECK_LABELS),
);

// ---- 1. shadowed ---------------------------------------------------------

const shadowedReport = analyzeSkills(
  report([
    goodSkill({ name: 'dup-skill', description: '这是一段足够长的技能描述用来测试遮蔽' }),
    goodSkill({
      name: 'dup-skill',
      filePath: 'C:\\Users\\x\\.agents\\skills\\dup-skill\\SKILL.md',
      entryPath: 'C:\\Users\\x\\.agents\\skills\\dup-skill',
      source: 'user-agents',
      rank: 500,
      shadowed: true,
      shadowedBy: 'C:\\Users\\x\\.dsh\\skills\\dup-skill\\SKILL.md',
    }),
  ]),
);

check('shadowed：被遮蔽的那份命中', countKind(shadowedReport, 'shadowed') === 1, String(countKind(shadowedReport, 'shadowed')));
check(
  'shadowed：detail 说清「永远不会被模型加载到」',
  shadowedReport.checks.find((row) => row.kind === 'shadowed')?.detail.includes('永远不会被模型加载到'),
);
check(
  'shadowed：detail 带上遮蔽者路径',
  shadowedReport.checks.find((row) => row.kind === 'shadowed')?.detail.includes('dup-skill\\SKILL.md'),
);
check(
  'shadowed 反例：没有 shadowed 标记的技能不报',
  countKind(analyzeSkills(report([goodSkill()])), 'shadowed') === 0,
);
check(
  'shadowed：命中的那条带 skill 名与来源',
  shadowedReport.checks.find((row) => row.kind === 'shadowed')?.skill === 'dup-skill' &&
    shadowedReport.checks.find((row) => row.kind === 'shadowed')?.source === 'user-agents',
);

// ---- 2. short-description -------------------------------------------------

const longDesc = '一二三四五六七八九十一二三四五六七八九十'; // 正好 20 字
check('fixture 自检：备用长描述正好 20 字', longDesc.trim().length === 20, String(longDesc.length));

const emptyDesc = analyzeSkills(
  report([goodSkill({ name: 'no-desc', description: '', dirEntry: true })]),
);
check('描述为空：命中 short-description', countKind(emptyDesc, 'short-description') === 1);
check(
  '描述为空：detail 逐字写明「描述为空」',
  emptyDesc.checks.find((row) => row.kind === 'short-description')?.detail.includes('描述为空'),
  emptyDesc.checks[0]?.detail,
);

const shortDesc = analyzeSkills(
  report([
    goodSkill({
      name: 'short-desc',
      description: '太短了',
      filePath: 'C:\\Users\\x\\.dsh\\skills\\short-desc\\SKILL.md',
      entryPath: 'C:\\Users\\x\\.dsh\\skills\\short-desc',
    }),
  ]),
);
check('描述 3 字：命中 short-description', countKind(shortDesc, 'short-description') === 1);
check(
  '描述 3 字：detail 带实际长度与阈值',
  shortDesc.checks[0]?.detail.includes('3 字') && shortDesc.checks[0]?.detail.includes('20 字'),
  shortDesc.checks[0]?.detail,
);

const exactDesc = analyzeSkills(
  report([
    goodSkill({
      name: 'exact-desc',
      description: longDesc,
      filePath: 'C:\\Users\\x\\.dsh\\skills\\exact-desc\\SKILL.md',
      entryPath: 'C:\\Users\\x\\.dsh\\skills\\exact-desc',
    }),
  ]),
);
check('反例：描述正好 20 字不报（阈值是 < 而不是 ≤）', countKind(exactDesc, 'short-description') === 0);
check(
  '反例：19 字仍然报（边界内）',
  countKind(
    analyzeSkills(
      report([
        goodSkill({
          name: 'nineteen',
          description: longDesc.slice(1),
          filePath: 'C:\\Users\\x\\.dsh\\skills\\nineteen\\SKILL.md',
          entryPath: 'C:\\Users\\x\\.dsh\\skills\\nineteen',
        }),
      ]),
    ),
    'short-description',
  ) === 1,
);
check(
  '反例：status 不是 ok 的条目根本不谈描述（它是另一类问题）',
  countKind(
    analyzeSkills(
      report([
        goodSkill({
          name: 'broken',
          description: '',
          status: 'dropped:no-frontmatter',
          enabled: false,
          bytes: 42,
        }),
      ]),
    ),
    'short-description',
  ) === 0,
);

// ---- 3. dir-name-mismatch -------------------------------------------------

const mismatch = analyzeSkills(
  report([
    goodSkill({
      name: 'office-docx',
      entryPath: 'C:\\Users\\x\\.dsh\\skills\\office\\SKILL.md-dir',
      filePath: 'C:\\Users\\x\\.dsh\\skills\\office\\SKILL.md-dir\\SKILL.md',
      description: 'Word 文档创建、读取、编辑与校验（.docx）',
    }),
  ]),
);
check('目录名≠技能名：命中 dir-name-mismatch', countKind(mismatch, 'dir-name-mismatch') === 1, kindsOf(mismatch).join(','));
check(
  '目录名≠技能名：detail 同时写出两个名字',
  mismatch.checks.find((row) => row.kind === 'dir-name-mismatch')?.detail.includes('office') &&
    mismatch.checks.find((row) => row.kind === 'dir-name-mismatch')?.detail.includes('office-docx'),
  mismatch.checks.find((row) => row.kind === 'dir-name-mismatch')?.detail,
);
check(
  '反例：目录名与 name 相同不报',
  countKind(analyzeSkills(report([goodSkill()])), 'dir-name-mismatch') === 0,
);
check(
  '反例：flat-md 表单不参与目录名检查（entryPath 是根本身，无意义）',
  countKind(
    analyzeSkills(
      report([
        goodSkill({
          name: 'flat-one',
          form: 'flat-md',
          entryPath: 'C:\\Users\\x\\.agents\\skills',
          filePath: 'C:\\Users\\x\\.agents\\skills\\flat-one.md',
          description: '一个扁平散的 md 技能描述，长度足够',
        }),
      ]),
    ),
    'dir-name-mismatch',
  ) === 0,
);
check(
  '反例：name 为空时不报目录名不一致（没有可比对象）',
  countKind(
    analyzeSkills(
      report([
        goodSkill({ name: '', entryPath: 'C:\\Users\\x\\.dsh\\skills\\unnamed', filePath: 'C:\\Users\\x\\.dsh\\skills\\unnamed\\SKILL.md' }),
      ]),
    ),
    'dir-name-mismatch',
  ) === 0,
);

// ---- 4. empty-body (heuristic on bytes) -----------------------------------

const emptyBody = analyzeSkills(report([goodSkill({ name: 'tiny', bytes: 120 })]));
check('副本正文疑似为空：命中 empty-body', countKind(emptyBody, 'empty-body') === 1);
check(
  'empty-body 的 detail 必须写明「按文件字节估计」（不许假装精确）',
  emptyBody.checks.find((row) => row.kind === 'empty-body')?.detail.includes('按文件字节估计'),
  emptyBody.checks.find((row) => row.kind === 'empty-body')?.detail,
);
check(
  'empty-body 的 detail 带实际字节数',
  emptyBody.checks.find((row) => row.kind === 'empty-body')?.detail.includes('120'),
);
check('反例：正好 300 字节不报（阈值是 <）', countKind(analyzeSkills(report([goodSkill({ bytes: 300 })])), 'empty-body') === 0);
check('反例：1629 字节不报', countKind(analyzeSkills(report([goodSkill()])), 'empty-body') === 0);
check(
  '反例：status 不是 ok 时只按各自的 dropped 类问题走，不额外报 empty-body',
  countKind(
    analyzeSkills(report([goodSkill({ status: 'error', reason: '读文件失败', bytes: 0 })])),
    'empty-body',
  ) === 0,
);

// ---- 5. 汇总 / 顺序 / 去重 -------------------------------------------------

const mixed = analyzeSkills(
  report([
    goodSkill({ name: 'a-good' }),
    goodSkill({
      name: 'b-empty-desc',
      description: '',
      entryPath: 'C:\\Users\\x\\.dsh\\skills\\b-empty-desc',
      filePath: 'C:\\Users\\x\\.dsh\\skills\\b-empty-desc\\SKILL.md',
    }),
    goodSkill({
      name: 'c-dir-name',
      entryPath: 'C:\\Users\\x\\.dsh\\skills\\c-dir-other',
      filePath: 'C:\\Users\\x\\.dsh\\skills\\c-dir-other\\SKILL.md',
    }),
    goodSkill({
      name: 'd-shadowed',
      shadowed: true,
      shadowedBy: 'C:\\Users\\x\\.dsh\\skills\\d-shadowed\\SKILL.md',
    }),
  ]),
);

check('汇总：total = 上报条目数', mixed.summary.total === 4, String(mixed.summary.total));
check('汇总：scanned = 可分析条目数', mixed.summary.scanned === 4, String(mixed.summary.scanned));
check('汇总：shortDescription 计数正确', mixed.summary.shortDescription === 1, String(mixed.summary.shortDescription));
check('汇总：dirNameMismatch 计数正确', mixed.summary.dirNameMismatch === 1, String(mixed.summary.dirNameMismatch));
check('汇总：shadowed 计数正确', mixed.summary.shadowed === 1, String(mixed.summary.shadowed));
check(
  '汇总：byKind 四类都在且与顶层计数一致',
  mixed.summary.byKind['short-description'] === mixed.summary.shortDescription &&
    mixed.summary.byKind['dir-name-mismatch'] === mixed.summary.dirNameMismatch &&
    mixed.summary.byKind['shadowed'] === mixed.summary.shadowed &&
    mixed.summary.byKind['empty-body'] === mixed.summary.emptyBody,
);
check('checks 顺序稳定：按 shadowed → short → dir-name → empty 分组', (() => {
  const order = ['shadowed', 'short-description', 'dir-name-mismatch', 'empty-body'];
  const seen = kindsOf(mixed).map((kind) => order.indexOf(kind));
  return seen.every((value, index) => index === 0 || seen[index - 1] <= value);
})(), kindsOf(mixed).join(','));
check(
  '每条都带 {kind, skill, detail}，且 detail 非空',
  mixed.checks.every((row) => row.kind && row.skill && typeof row.detail === 'string' && row.detail !== ''),
);
check('note 讲明是启发式', mixed.ok === true && String(mixed.note).includes('按文件字节估计'), mixed.note);

// 同一技能同时踩多类：各自只出现一次
const multi = analyzeSkills(
  report([goodSkill({ name: 'multi', description: '', bytes: 80, entryPath: 'C:\\Users\\x\\.dsh\\skills\\other-dir', filePath: 'C:\\Users\\x\\.dsh\\skills\\other-dir\\SKILL.md' })]),
);
check(
  '一个技能可以同时命中多类（短描述 + 目录名 + 空正文 = 3 条）',
  multi.checks.length === 3,
  kindsOf(multi).join(','),
);
check(
  '同一技能同一类问题不重复出现',
  new Set(multi.checks.map((row) => `${row.kind}|${row.skill}`)).size === multi.checks.length,
);
check(
  '重复条目（同 filePath 同问题）只报一次',
  analyzeSkills(
    report([
      goodSkill({ name: 'twice', description: '', filePath: 'C:\\x\\twice\\SKILL.md', entryPath: 'C:\\x\\twice' }),
      goodSkill({ name: 'twice', description: '', filePath: 'C:\\x\\twice\\SKILL.md', entryPath: 'C:\\x\\twice' }),
    ]),
  ).checks.length === 1,
);

// ---- 6. 阈值可覆盖 -------------------------------------------------------

const relaxed = analyzeSkills(report([goodSkill({ description: '短描述', bytes: 120 })]), {
  minDescriptionLength: 2,
  emptyBodyBytes: 100,
});
check('阈值覆盖：描述阈值放到 2 字后不再报短描述', countKind(relaxed, 'short-description') === 0);
check('阈值覆盖：字节阈值降到 100 后 120 字节不再报空正文', countKind(relaxed, 'empty-body') === 0);
check(
  '阈值覆盖：thresholds 回显生效值',
  relaxed.thresholds.minDescriptionLength === 2 && relaxed.thresholds.emptyBodyBytes === 100,
  JSON.stringify(relaxed.thresholds),
);
check(
  '阈值覆盖：非法值（负数 / NaN / 字符串）回落默认',
  analyzeSkills(report([]), { minDescriptionLength: -1, emptyBodyBytes: 'much' }).thresholds.minDescriptionLength ===
    MIN_DESCRIPTION_LENGTH &&
    analyzeSkills(report([]), { emptyBodyBytes: Number.NaN }).thresholds.emptyBodyBytes === EMPTY_BODY_BYTES,
);

// ---- 7. 畸形输入绝不抛 ---------------------------------------------------

const malformed = [
  ['undefined', undefined],
  ['null', null],
  ['{}', {}],
  ['skills 不是数组', { skills: 'nope' }],
  ['skills 里混着 null 与数组', { skills: [null, [], goodSkill()] }],
  ['description 不是字符串', { skills: [goodSkill({ description: 42 })] }],
  ['bytes 是字符串', { skills: [goodSkill({ bytes: '120' })] }],
  ['entryPath 缺失', { skills: [goodSkill({ name: 'x', entryPath: undefined, filePath: undefined })] }],
];
let threw = null;
let malformedOk = true;
for (const [label, input] of malformed) {
  try {
    const result = analyzeSkills(input);
    if (result.ok !== true || !Array.isArray(result.checks)) malformedOk = false;
  } catch (error) {
    malformedOk = false;
    threw = `${label}: ${error.message}`;
  }
}
check('畸形输入（8 种）一律不抛，且仍返回 ok:true + checks 数组', malformedOk, threw ?? `${malformed.length} 种`);
check('畸形输入：空报告给出 0 条问题', analyzeSkills({}).checks.length === 0);
check(
  '畸形输入：null 条目不参与扫描计数',
  analyzeSkills({ skills: [null, goodSkill()] }).summary.scanned === 1,
);

// ---- 8. 不修改入参 -------------------------------------------------------

const frozen = report([goodSkill()]);
const before = JSON.stringify(frozen);
analyzeSkills(frozen);
check('纯函数：不修改传入的报告', JSON.stringify(frozen) === before);


// ---- 9. 0.6.37 新增：root-missing / invalid-entry / evidence -----------------

const rootReport = {
  skills: [goodSkill({ name: 'broken-one', status: 'dropped:bad-yaml', reason: 'unexpected end of stream' })],
  roots: [
    { source: 'custom', path: 'C:\\Users\\x\\missing-skills', rank: 300, exists: false, configured: true },
    { source: 'user-dsh', path: 'C:\\Users\\x\\.dsh\\skills', rank: 10, exists: true, configured: true },
    { source: 'bundled', path: null, rank: 0, exists: false, configured: false },
  ],
};
const withRoots = analyzeSkills(rootReport);
const rootRow = withRoots.checks.find((row) => row.kind === 'root-missing');
check('技能根不存在 → root-missing 一条', withRoots.summary.rootMissing === 1 && Boolean(rootRow));
check(
  'root-missing 的 evidence 带 path/source（不再恒 null）',
  Boolean(rootRow && rootRow.evidence && rootRow.evidence.path === 'C:\\Users\\x\\missing-skills' && rootRow.evidence.source === 'custom'),
);
check('exists:true 与 configured:false 的根都不报', withRoots.checks.filter((row) => row.kind === 'root-missing').length === 1);

const entryRow = withRoots.checks.find((row) => row.kind === 'invalid-entry');
check('dropped:bad-yaml → invalid-entry 一条', withRoots.summary.invalidEntry === 1 && Boolean(entryRow));
check('invalid-entry 说人话（含 YAML 与「模型看不到」）', Boolean(entryRow && /YAML/.test(entryRow.detail) && /模型看不到/.test(entryRow.detail)));
check('invalid-entry 的 evidence 带 status 与 reason', Boolean(entryRow && entryRow.evidence && entryRow.evidence.status === 'dropped:bad-yaml' && /unexpected end/.test(entryRow.evidence.reason || '')));

const shadowEvidence = analyzeSkills(report([goodSkill({ name: 'dup', shadowed: true, shadowedBy: 'C:\\Users\\x\\.dsh\\skills\\dup\\SKILL.md' })]));
const shadowRow = shadowEvidence.checks.find((row) => row.kind === 'shadowed');
check('shadowed 的 evidence 带 shadowedBy', Boolean(shadowRow && shadowRow.evidence && /dup/.test(shadowRow.evidence.shadowedBy || '')));

// ---- report ---------------------------------------------------------------

mkdirSync(reportDir, { recursive: true });
writeFileSync(
  join(reportDir, 'checks-report.json'),
  JSON.stringify(
    {
      constants: { MIN_DESCRIPTION_LENGTH, EMPTY_BODY_BYTES, CHECK_KINDS, CHECK_LABELS },
      mixedSummary: mixed.summary,
      sample: mixed.checks,
      checks,
    },
    null,
    2,
  ),
);
console.log(`\n报告已写：${join(reportDir, 'checks-report.json')}`);

const failed = checks.filter((row) => !row.ok);
console.log(`\n=== 诊断套件自测：${checks.length - failed.length}/${checks.length} 通过 ===`);
process.exit(failed.length === 0 ? 0 : 1);
