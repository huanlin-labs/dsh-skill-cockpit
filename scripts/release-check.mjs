#!/usr/bin/env node
/**
 * release:check —— 发版四处一致性机器检查（V3 · R1）
 *
 * 查七项：
 *   1. package.json.version 是合法 semver
 *   2. CHANGELOG.md 顶部条目 = 当前版本
 *   3. npm latest（registry.npmjs.org）= 当前版本
 *   4. 本地 tag v<version> 存在
 *   5. 远端 tag v<version> 存在（git ls-remote）
 *   6. GitHub Release v<version> 存在（gh release view）
 *   7. 分发元数据：keywords 覆盖核心词、repository 指 GitHub、dsh.bundle.patch 文件存在、GitHub topics 覆盖核心词
 *
 * 退出码：0 = 全绿；1 = 有 FAIL（真不一致）；2 = 没有 FAIL 但有 UNKNOWN（网络/gh 不可用等环境问题）。
 *   ⚠️ 2 不是绿：说明这次没验成，别当成通过。
 *
 * 参数：
 *   --offline              跳过 npm / git ls-remote / gh（只查本地项）
 *   --package-version x.y.z 自测用：假装 package.json 是这个版本（验证「写错必红」）
 *   --registry <url>       默认 https://registry.npmjs.org
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REQUIRED_KEYWORDS = ['dsh', 'dsh-plugin', 'dsh-bundle', 'deepseek-harness', 'cordis'];
const REQUIRED_TOPICS = ['dsh', 'dsh-plugin', 'dsh-bundle', 'deepseek-harness', 'cordis'];

const args = process.argv.slice(2);
const offline = args.includes('--offline');
const flag = (name, fallback = null) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const registry = flag('--registry', 'https://registry.npmjs.org');
const pretendVersion = flag('--package-version');
// Windows 上 npm 是 npm.cmd；Node 20+ 出于安全不允许直接 execFileSync('.cmd')，要走 shell
const NPM = 'npm';
const shellFor = (cmd) => process.platform === 'win32' && cmd === NPM;

const results = [];
const record = (level, name, detail) => {
  results.push({ level, name, detail });
  const mark = level === 'PASS' ? 'PASS' : level === 'FAIL' ? 'FAIL' : 'UNKN';
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ''}`);
};

function run(cmd, cmdArgs, opts = {}) {
  try {
    const out = execFileSync(cmd, cmdArgs, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
      shell: shellFor(cmd),
      ...opts,
    });
    return { ok: true, out: String(out).trim() };
  } catch (error) {
    const stderr = String(error?.stderr ?? '').trim().split(/\r?\n/).slice(-2).join(' / ');
    return { ok: false, out: String(error?.stdout ?? '').trim(), error: stderr || String(error?.message ?? error) };
  }
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const version = pretendVersion || pkg.version;
if (pretendVersion) record('UNKNOWN', '自测模式', `用 --package-version ${pretendVersion} 覆盖 package.json 的 ${pkg.version}`);

// 1 · semver
if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) record('PASS', 'package.json.version 合法', version);
else record('FAIL', 'package.json.version 合法', `不是 semver：${version}`);

// 2 · CHANGELOG 顶部条目
const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
const top = /^##\s+(\S+)/m.exec(changelog);
if (top && top[1] === version) record('PASS', 'CHANGELOG 顶部 = 当前版本', top[1]);
else if (top && /^未发布/.test(top[1])) record('FAIL', 'CHANGELOG 顶部 = 当前版本', `顶部是 ${top[1]}（攒着未发版改动）——先 bump package.json 版本，再把该标题改成新版本号；不要删这一节`);
else record('FAIL', 'CHANGELOG 顶部 = 当前版本', `顶部是 ${top ? top[1] : '(没找到 ## 条目)'}，版本是 ${version}`);

// 3 · npm latest
if (offline) {
  record('UNKNOWN', 'npm latest 一致', '--offline 跳过');
} else {
  const npm = run(NPM, ['view', pkg.name, 'version', '--registry', registry]);
  if (!npm.ok) record('UNKNOWN', 'npm latest 一致', `npm view 失败：${npm.error}`);
  else if (npm.out === version) record('PASS', 'npm latest 一致', npm.out);
  else record('FAIL', 'npm latest 一致', `npm 上是 ${npm.out}，本地是 ${version}`);
}

// 4 · 本地 tag
const localTag = `v${version}`;
const tagLookup = run('git', ['rev-parse', '--verify', `refs/tags/${localTag}`]);
if (tagLookup.ok) record('PASS', `本地 tag ${localTag} 存在`, tagLookup.out.slice(0, 7));
else record('FAIL', `本地 tag ${localTag} 存在`, 'git rev-parse 找不到');

// 5 · 远端 tag
if (offline) {
  record('UNKNOWN', `远端 tag ${localTag} 存在`, '--offline 跳过');
} else {
  const remote = run('git', ['ls-remote', '--tags', 'origin', `refs/tags/${localTag}`]);
  if (!remote.ok) record('UNKNOWN', `远端 tag ${localTag} 存在`, `ls-remote 失败：${remote.error}`);
  else if (remote.out.includes(`refs/tags/${localTag}`)) record('PASS', `远端 tag ${localTag} 存在`, remote.out.split(/\s+/)[0].slice(0, 7));
  else record('FAIL', `远端 tag ${localTag} 存在`, '远端没有这个 tag');
}

// 6 · GitHub Release
const repoMatch = /github\.com[/:]([^/]+)\/([^/.]+)/.exec(pkg.repository?.url ?? '');
const repo = repoMatch ? `${repoMatch[1]}/${repoMatch[2]}` : '';
if (offline) {
  record('UNKNOWN', 'GitHub Release 存在', '--offline 跳过');
} else if (!repo) {
  record('FAIL', 'GitHub Release 存在', 'package.json 里没有可解析的 GitHub repository');
} else {
  const release = run('gh', ['release', 'view', localTag, '--repo', repo, '--json', 'tagName,publishedAt,url']);
  if (release.ok) {
    const info = JSON.parse(release.out);
    record('PASS', 'GitHub Release 存在', `${info.tagName} · ${info.url}`);
  } else if (/not found|could not find|release not found/i.test(release.error)) {
    record('FAIL', 'GitHub Release 存在', `${repo} 没有 ${localTag} 的 Release`);
  } else {
    record('UNKNOWN', 'GitHub Release 存在', `gh 不可用或未登录：${release.error}`);
  }
}

// 7 · 分发元数据
const keywords = Array.isArray(pkg.keywords) ? pkg.keywords : [];
const missingKeywords = REQUIRED_KEYWORDS.filter((word) => !keywords.includes(word));
if (missingKeywords.length === 0) record('PASS', 'npm keywords 覆盖核心词', REQUIRED_KEYWORDS.join(','));
else record('FAIL', 'npm keywords 覆盖核心词', `缺 ${missingKeywords.join(',')}`);

if (repo) record('PASS', 'repository 指向 GitHub', repo);
else record('FAIL', 'repository 指向 GitHub', String(pkg.repository?.url ?? '(空)'));

const patch = pkg.dsh?.bundle?.patch;
if (typeof patch === 'string' && patch !== '' && existsSync(join(ROOT, patch))) record('PASS', 'dsh.bundle.patch 文件存在', patch);
else record('FAIL', 'dsh.bundle.patch 文件存在', `package.json 声明 ${JSON.stringify(patch)}，文件不存在`);

if (offline || !repo) {
  record('UNKNOWN', 'GitHub topics 覆盖核心词', offline ? '--offline 跳过' : '取不到 repo');
} else {
  const topics = run('gh', ['repo', 'view', repo, '--json', 'repositoryTopics']);
  if (!topics.ok) {
    record('UNKNOWN', 'GitHub topics 覆盖核心词', `gh 不可用或未登录：${topics.error}`);
  } else {
    const names = (JSON.parse(topics.out).repositoryTopics ?? []).map((row) => row.name);
    const missing = REQUIRED_TOPICS.filter((word) => !names.includes(word));
    if (missing.length === 0) record('PASS', 'GitHub topics 覆盖核心词', names.join(','));
    else record('FAIL', 'GitHub topics 覆盖核心词', `缺 ${missing.join(',')}`);
  }
}

// 汇总
const fails = results.filter((row) => row.level === 'FAIL');
const unknowns = results.filter((row) => row.level === 'UNKNOWN');
console.log('');
console.log(`汇总：PASS ${results.length - fails.length - unknowns.length} · FAIL ${fails.length} · UNKNOWN ${unknowns.length}（版本 ${version}）`);
if (fails.length > 0) {
  console.log('结论：不一致 —— 先修 FAIL 项再发版。');
  process.exit(1);
}
if (unknowns.length > 0) {
  console.log('结论：没有发现不一致，但有些项没验成（UNKNOWN）—— 不算通过。');
  process.exit(2);
}
console.log('结论：四处一致，可以发版。');
process.exit(0);
