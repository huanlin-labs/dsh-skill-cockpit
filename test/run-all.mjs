/**
 * Skill panel · run every self-test.
 *
 *   node test/run-all.mjs [reportDir]
 *
 * Exit code 0 only when every suite passes. stdio is inherited on purpose
 * (no pipes), so this works even in a confined shell.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const reportDir = resolve(process.argv[2] ?? join(import.meta.dirname, 'out'));
mkdirSync(reportDir, { recursive: true });

const suites = [
  ['数据层', join(import.meta.dirname, 'run-data-layer.mjs')],
  ['开关闭环', join(import.meta.dirname, 'run-toggle.mjs')],
  ['宿主路由', join(import.meta.dirname, 'run-routes.mjs')],
  ['客户端', join(import.meta.dirname, 'run-client.mjs')],
  // 0.3.0: usage reading (multi-frame zstd) and the "loads but earns nothing" checks.
  ['用量', join(import.meta.dirname, 'run-usage.mjs')],
  ['诊断', join(import.meta.dirname, 'run-checks.mjs')],
  ['四态', join(import.meta.dirname, 'run-mode.mjs')],
];

const results = [];
for (const [label, script] of suites) {
  console.log(`\n########## ${label}：${script} ##########`);
  const result = spawnSync(process.execPath, [script, reportDir], { stdio: 'inherit' });
  results.push({ label, script, code: result.status });
}

console.log('\n########## 汇总 ##########');
for (const row of results) {
  console.log(`${row.code === 0 ? 'PASS' : 'FAIL'}  ${row.label}  (exit ${row.code})`);
}
const failed = results.filter((r) => r.code !== 0);
console.log(`\n${results.length - failed.length}/${results.length} 个套件通过 · 报告目录 ${reportDir}`);
process.exit(failed.length === 0 ? 0 : 1);
