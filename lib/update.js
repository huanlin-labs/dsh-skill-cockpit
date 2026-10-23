/**
 * dsh-skill-cockpit · 上游更新（0.11.0）
 *
 * 一个 skill 就是一个文件夹 —— 没有 npm 那种 registry / 版本号 / 通知。
 * 「上游有没有更新」只能回答一件事：**上游仓库里这个路径的现在，跟装着的这份一不一样？**
 *
 * 做法（只读上游，绝不动别人的工作树）：
 *   1. 定位上游：技能目录所在 git 工作树的 origin + 相对路径；或 upstreams.json 里配的 {url, path}。
 *   2. 取内容：`git clone --filter=blob:none --no-checkout --depth 1`（只下提交与树，不下文件），
 *      再 `sparse-checkout set --no-cone <路径>` + `checkout` —— 只把**这几个 skill 的文件**拉下来。
 *      （整仓 fetch 在实测里要十几分钟；这个方式一个仓库十几秒。）
 *   3. 比对：两边目录做内容指纹，一样 = 已最新，不一样 = 有更新。
 *   4. 更新：旧目录整份复制进回收站，再用上游那份替换。
 *
 * 诚实的失败：找不到上游 → 「无上游」；网络/代理失败 → 报错原文，绝不当成「已是最新」。
 */

import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export const UPSTREAMS_FILE = 'upstreams.json';

/** 覆盖表：{ "<技能名>": { "url": "https://…", "path": "skills/<名字>" } } —— 给本机目录不是 git 的情况。 */
export function readUpstreams(home) {
  const file = join(home, 'skill-cockpit', UPSTREAMS_FILE);
  if (!existsSync(file)) return { ok: true, file, entries: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return { ok: true, file, entries: parsed && typeof parsed === 'object' ? parsed : {} };
  } catch (error) {
    return { ok: false, file, entries: {}, error: `upstreams.json 不是合法 JSON：${error?.message ?? error}` };
  }
}

function gitRun(args, { cwd, timeout = 180000 } = {}) {
  const base = { cwd, encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } };
  const first = spawnSync('git', args, base);
  const text = `${first.stderr ?? ''}${first.stdout ?? ''}`;
  if (first.status === 0) return { ok: true, out: `${first.stdout ?? ''}`.trim(), err: '', code: 0 };
  const proxyish = /proxy|could not connect|failed to connect|timed out|operation too slow/i.test(text);
  return { ok: false, out: `${first.stdout ?? ''}`.trim(), err: text.trim() || `git 退出码 ${first.status}`, code: first.status, proxyish };
}

/** 最近的工作树根（含 .git 的目录）。 */
function gitWorktreeOf(dir) {
  let current = resolve(dir);
  for (;;) {
    if (existsSync(join(current, '.git'))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** 目录内容指纹：相对路径 + 字节。 */
export function hashDir(dir) {
  const hash = createHash('sha1');
  const walk = (base, rel) => {
    for (const entry of readdirSync(join(base, rel), { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const next = rel === '' ? entry.name : `${rel}/${entry.name}`;
      const full = join(base, next);
      if (entry.isDirectory()) {
        walk(base, next);
        continue;
      }
      if (!entry.isFile() || !statSync(full).isFile()) continue;
      hash.update(next);
      hash.update('\0');
      hash.update(readFileSync(full));
      hash.update('\0');
    }
  };
  walk(resolve(dir), '');
  return hash.digest('hex');
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 技能 → 上游坐标 {kind:'repo'|'remote'|'none', url, rel, local}。 */
export function resolveUpstream({ name, skillDir, overrides = {} }) {
  if (typeof skillDir !== 'string' || skillDir.trim() === '') return { kind: 'none' };
  const override = name && overrides && typeof overrides === 'object' ? overrides[name] : null;
  if (override && typeof override.url === 'string' && override.url.trim() !== '') {
    return {
      kind: 'remote',
      url: override.url.trim(),
      rel: typeof override.path === 'string' ? override.path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') : '',
      local: skillDir,
    };
  }
  const repo = gitWorktreeOf(skillDir);
  if (!repo) return { kind: 'none' };
  const remote = gitRun(['remote', 'get-url', 'origin'], { cwd: repo, timeout: 20000 });
  if (!remote.ok || remote.out === '') return { kind: 'none' };
  const rel = resolve(skillDir).slice(resolve(repo).length + 1).replace(/\\/g, '/');
  return { kind: 'repo', url: remote.out, rel, local: skillDir, worktree: repo };
}

/**
 * 上游快照：一个远端只克隆一次（只拿到树），之后按路径取文件。
 * 调用方负责 dispose()。
 */
function openSnapshot(url) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-upstream-'));
  const clone = gitRun(['clone', '--filter=blob:none', '--no-checkout', '--depth', '1', '--quiet', url, dir], { timeout: 180000 });
  if (!clone.ok) {
    if (clone.proxyish) {
      // 本机常配着「代理没开」的 git config：直连再试一次。
      rmSync(dir, { recursive: true, force: true });
      const direct = gitRun(['-c', 'http.proxy=', '-c', 'https.proxy=', 'clone', '--filter=blob:none', '--no-checkout', '--depth', '1', '--quiet', url, dir], { timeout: 180000 });
      if (!direct.ok) {
        rmSync(dir, { recursive: true, force: true });
        throw new Error(`连不上上游：${direct.err}`);
      }
      // 懒加载的 blob 也会走代理，这里把克隆内的代理清空，后续 checkout 才能下到文件。
      gitRun(['config', 'http.proxy', ''], { cwd: dir, timeout: 10000 });
      gitRun(['config', 'https.proxy', ''], { cwd: dir, timeout: 10000 });
    } else {
      rmSync(dir, { recursive: true, force: true });
      throw new Error(`连不上上游：${clone.err}`);
    }
  }
  return {
    dir,
    /** 取出一批路径（一次 sparse set + 一次 checkout）。 */
    fetchPaths(paths) {
      const wanted = [...new Set(paths.filter((p) => typeof p === 'string' && p.trim() !== ''))];
      if (wanted.length === 0) return;
      const set = gitRun(['sparse-checkout', 'set', '--no-cone', ...wanted], { cwd: dir, timeout: 60000 });
      if (!set.ok) throw new Error(`上游路径定位失败：${set.err}`);
      const co = gitRun(['checkout', '--quiet'], { cwd: dir, timeout: 240000 });
      if (!co.ok) throw new Error(`下载上游文件失败：${co.err}`);
    },
    pathOf(rel) {
      return join(dir, ...rel.split('/').filter(Boolean));
    },
    dispose() {
      // git 克隆里的对象文件是只读的，Windows 上直接删会 EPERM —— 多试几次，删不掉也不影响结果。
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        /* 临时目录留在 %TEMP%，随系统清理 */
      }
    },
  };
}

/**
 * 检查一批技能。skills: [{name, entryPath}]。
 * 同一个远端只克隆一次；状态：current / behind / no-upstream / error。
 */
export function checkUpdates({ skills = [], overrides = {} } = {}) {
  const targets = [];
  for (const skill of skills) {
    const name = typeof skill?.name === 'string' ? skill.name : '';
    const entryPath = typeof skill?.entryPath === 'string' ? skill.entryPath : '';
    if (name === '' || entryPath === '') continue;
    let upstream;
    try {
      upstream = resolveUpstream({ name, skillDir: entryPath, overrides });
    } catch (error) {
      targets.push({ name, entryPath, status: 'error', error: String(error?.message ?? error) });
      continue;
    }
    if (upstream.kind === 'none') {
      targets.push({ name, entryPath, status: 'no-upstream', remote: '', changedFiles: 0 });
      continue;
    }
    targets.push({ name, entryPath, upstream, status: 'pending' });
  }

  const byUrl = new Map();
  for (const row of targets) {
    if (row.status !== 'pending') continue;
    if (!byUrl.has(row.upstream.url)) byUrl.set(row.upstream.url, []);
    byUrl.get(row.upstream.url).push(row);
  }

  for (const [url, rows] of byUrl) {
    let snap;
    try {
      snap = openSnapshot(url);
    } catch (error) {
      for (const row of rows) {
        row.status = 'error';
        row.error = String(error?.message ?? error);
        row.remote = url;
      }
      continue;
    }
    try {
      snap.fetchPaths(rows.map((row) => row.upstream.rel));
      for (const row of rows) {
        const upstreamDir = row.upstream.rel === '' ? snap.dir : snap.pathOf(row.upstream.rel);
        if (!existsSync(upstreamDir)) {
          row.status = 'error';
          row.error = `上游里找不到这个路径：${row.upstream.rel || '(仓库根)'}`;
          continue;
        }
        const same = hashDir(upstreamDir) === hashDir(row.entryPath);
        row.status = same ? 'current' : 'behind';
        row.remote = url;
        row.path = row.upstream.rel;
      }
    } catch (error) {
      for (const row of rows) {
        row.status = 'error';
        row.error = String(error?.message ?? error);
        row.remote = url;
      }
    } finally {
      snap.dispose();
    }
  }

  const results = targets.map((row) => ({
    name: row.name,
    status: row.status,
    remote: row.remote ?? '',
    path: row.path ?? row.upstream?.rel ?? '',
    changedFiles: row.status === 'behind' ? null : 0,
    error: row.error,
  }));
  return { ok: true, checkedAt: new Date().toISOString(), results };
}

/** 单个技能更新：备份 → 用上游内容替换。 */
export function updateSkill({ name, skillDir, trashRoot, overrides = {} } = {}) {
  if (typeof skillDir !== 'string' || skillDir.trim() === '') throw new Error('缺少技能目录');
  if (!existsSync(skillDir)) throw new Error(`技能目录不存在：${skillDir}`);
  const upstream = resolveUpstream({ name, skillDir, overrides });
  if (upstream.kind === 'none') throw new Error('没有上游：这个目录不在任何 git 仓库里，也没在 upstreams.json 里配地址');
  if (upstream.rel === '') throw new Error('上游路径为空：请在 upstreams.json 里补 path');

  const snap = openSnapshot(upstream.url);
  try {
    snap.fetchPaths([upstream.rel]);
    const upstreamDir = snap.pathOf(upstream.rel);
    if (!existsSync(upstreamDir)) throw new Error(`上游里找不到这个路径：${upstream.rel}`);

    const localHash = hashDir(skillDir);
    const upstreamHash = hashDir(upstreamDir);
    if (localHash === upstreamHash) {
      return { ok: true, updated: false, status: 'current', name, remote: upstream.url, skillDir };
    }

    const root = typeof trashRoot === 'string' && trashRoot.trim() !== '' ? resolve(trashRoot) : join(tmpdir(), 'dsh-skill-trash');
    const dest = join(root, `${stamp()}-${basename(skillDir)}`);
    cpSync(skillDir, dest, { recursive: true, errorOnExist: true, force: false });
    if (!existsSync(dest)) throw new Error('备份到回收站失败，原目录未动');
    rmSync(skillDir, { recursive: true, force: false });
    cpSync(upstreamDir, skillDir, { recursive: true, force: true });
    return {
      ok: true,
      updated: true,
      status: 'updated',
      name,
      remote: upstream.url,
      path: upstream.rel,
      skillDir,
      trashPath: dest,
      from: localHash.slice(0, 12),
      to: upstreamHash.slice(0, 12),
    };
  } finally {
    snap.dispose();
  }
}
