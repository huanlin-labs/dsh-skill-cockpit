/**
 * Skill panel · 四态开关 self-test (runs setSkillMode FOR REAL, in a sandbox).
 *
 *   node test/run-mode.mjs [reportDir]
 *
 * Why this suite exists (log §77): v0.6.8 shipped with setSkillMode using
 * readFileSync / copyFileSync / writeFileSync / applyModeToText while the file
 * imported none of them. `node --check` cannot see an undefined identifier and
 * no other suite ever *called* setSkillMode, so six green suites proved nothing
 * and the four-state switch failed on every click. This suite executes the real
 * function on a throwaway root, so a missing import now fails the build.
 *
 * Discipline: nothing outside a mkdtemp root is touched — no real skill, no
 * ~/.dsh/skills entry is ever read or written.
 *
 * What it proves:
 *   1. a DIRECTORY entry path is accepted (the panel sends .../docx, not the file);
 *   2. on -> off renames SKILL.md -> SKILL.md.disabled, bytes untouched;
 *   3. off -> on restores the file NAME (the old early-return skipped the rename);
 *   4. on -> user-only writes disable-model-invocation: true;
 *   5. user-only -> model-only swaps the gate key to user-invocable: false;
 *   6. model-only -> on clears both keys;
 *   7. plan:true writes nothing at all;
 *   8. a file outside every writable root is refused.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setSkillMode } from '../lib/toggle.js';

const reportDir = resolve(process.argv[2] ?? join(import.meta.dirname, 'out'));
const SUFFIX = '.disabled';

const checks = [];
const record = (name, pass, detail) => {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const home = mkdtempSync(join(tmpdir(), 'skill-mode-'));
const root = join(home, 'skills');
const skillDir = join(root, 'demo');
const entry = join(skillDir, 'SKILL.md');
const disabled = `${entry}${SUFFIX}`;
const original = [
  '---',
  'name: demo',
  'description: 一个只用于四态开关自检的示例技能，描述长度足够，不参与真实扫描。',
  '---',
  '',
  '# Demo',
  '',
  '正文若干行，确保 writeBackup 的字节比对有意义。',
  '',
].join('\n');

const options = { dshHome: home, includeDefaultRoots: true };
const text = () => (existsSync(entry) ? readFileSync(entry, 'utf8') : readFileSync(disabled, 'utf8'));

try {
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(entry, original, 'utf8');

  // 1. plan:true must not touch a single byte on disk.
  const planned = setSkillMode({ filePath: skillDir, mode: 'user-only', plan: true }, options);
  record(
    'plan:true 只算不写',
    existsSync(entry) && readFileSync(entry, 'utf8') === original && planned.applied !== true,
    `applied=${String(planned.applied)}`,
  );

  // 2. on -> off, addressed by the DIRECTORY (what the panel really sends).
  const off = setSkillMode({ filePath: skillDir, mode: 'off' }, options);
  record(
    '目录路径 → off 改名成功',
    off.applied === true && existsSync(disabled) && !existsSync(entry),
    `applied=${String(off.applied)}`,
  );
  record('off 不改正文一个字节', readFileSync(disabled, 'utf8') === original);

  // 3. off -> on must restore the FILE NAME, not just the frontmatter.
  const back = setSkillMode({ filePath: skillDir, mode: 'on' }, options);
  record(
    'off → on 恢复文件名',
    back.applied === true && existsSync(entry) && !existsSync(disabled),
    `applied=${String(back.applied)} restored=${String(back.restoredFromDisabled)}`,
  );

  // 4. on -> user-only
  const uo = setSkillMode({ filePath: entry, mode: 'user-only' }, options);
  record(
    'on → 仅人工 写入 disable-model-invocation',
    uo.applied === true && /^disable-model-invocation:\s*true\s*$/m.test(text()),
  );

  // 5. user-only -> model-only
  const mo = setSkillMode({ filePath: entry, mode: 'model-only' }, options);
  const moText = text();
  record(
    '仅人工 → 仅模型 换成 user-invocable: false',
    mo.applied === true && /^user-invocable:\s*false\s*$/m.test(moText) && !/disable-model-invocation/.test(moText),
  );

  // 6. model-only -> on clears both gates
  const on = setSkillMode({ filePath: entry, mode: 'on' }, options);
  const onText = text();
  record(
    '仅模型 → 全开 清掉两个闸门键',
    on.applied === true && !/disable-model-invocation|user-invocable/.test(onText),
  );


  // 6b. off -> user-only must restore the FILE NAME too (regression that was missing)
  setSkillMode({ filePath: skillDir, mode: 'off' }, options);
  const uoFromOff = setSkillMode({ filePath: skillDir, mode: 'user-only' }, options);
  record(
    '关 → 仅人工：恢复原名并写入 disable-model-invocation',
    uoFromOff.applied === true && existsSync(entry) && !existsSync(disabled) && /^disable-model-invocation:\s*true\s*$/m.test(text()),
    `applied=${String(uoFromOff.applied)} restored=${String(uoFromOff.restoredFromDisabled)}`,
  );
  setSkillMode({ filePath: entry, mode: 'on' }, options);

  // 7. a path outside every writable root is refused (the write gate holds).
  const outside = join(home, 'elsewhere');
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, 'SKILL.md'), original, 'utf8');
  let refused = false;
  try {
    setSkillMode({ filePath: join(outside, 'SKILL.md'), mode: 'off' }, options);
  } catch {
    refused = true;
  }
  record('可写根之外一律拒绝', refused);
} finally {
  rmSync(home, { recursive: true, force: true });
}

const failed = checks.filter((c) => !c.pass);
mkdirSync(reportDir, { recursive: true });
writeFileSync(
  join(reportDir, 'mode.json'),
  `${JSON.stringify({ suite: 'mode', checks, passed: checks.length - failed.length }, null, 2)}\n`,
  'utf8',
);
console.log(`\n四态：${checks.length - failed.length}/${checks.length} 项通过`);
process.exit(failed.length === 0 ? 0 : 1);
