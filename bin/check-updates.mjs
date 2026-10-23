#!/usr/bin/env node
/**
 * 上游检查（无会话版）：由 Windows 计划任务调用，不需要 dsh 在跑，不调用任何模型。
 *   node bin/check-updates.mjs        → 结果写 <DSH home>/skill-cockpit/update-report.json
 * 退出码：0 = 跑完（有没有更新都算成功）；1 = 出错。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { scanSkills } from '../lib/scan.js';
import { checkUpdates, readUpstreams } from '../lib/update.js';

const home = (process.env.DSH_HOME ?? '').trim() === '' ? join(homedir(), '.dsh') : process.env.DSH_HOME;
const outFile = join(home, 'skill-cockpit', 'update-report.json');

function readLocal() {
  const file = join(home, 'skill-cockpit', 'local.json');
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

try {
  const local = readLocal();
  const report = scanSkills({
    dshHome: home,
    agentsHome: (process.env.DSH_AGENTS_HOME ?? '').trim() || undefined,
    customSkillDirs: Array.isArray(local.customSkillDirs) ? local.customSkillDirs : undefined,
    includeDefaultRoots: true,
  });
  const skills = (report.skills ?? [])
    .filter((row) => row.form === 'dir-bundle' && typeof row.entryPath === 'string')
    .map((row) => ({ name: row.name, entryPath: row.entryPath }));
  const overrides = readUpstreams(home).entries;
  const result = checkUpdates({ skills, overrides });
  const counts = {
    behind: result.results.filter((row) => row.status === 'behind').length,
    current: result.results.filter((row) => row.status === 'current').length,
    none: result.results.filter((row) => row.status === 'no-upstream').length,
    error: result.results.filter((row) => row.status === 'error').length,
  };
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(
    outFile,
    JSON.stringify({ ok: true, checkedAt: new Date().toISOString(), counts, results: result.results }, null, 2),
    'utf8',
  );
  console.log(
    `[skill-cockpit] 上游检查完成：${counts.behind} 个有更新 · ${counts.current} 个已最新 · ${counts.none} 个无上游 · ${counts.error} 个出错`,
  );
  console.log(`[skill-cockpit] 报告：${outFile}`);
  process.exit(0);
} catch (error) {
  console.error(`[skill-cockpit] 上游检查失败：${error?.message ?? error}`);
  process.exit(1);
}
