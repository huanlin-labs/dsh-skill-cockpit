/**
 * dsh-skill-panel · discovery + classification.
 *
 * Enumerates every skill entry under every configured root and reports, for
 * each one, what the model would actually see:
 *
 *   status 'ok'                     → loads fine (enabled true) or is parked
 *                                     as `.disabled` (enabled false)
 *   status 'dropped:no-frontmatter' → the runtime silently discards it
 *   status 'dropped:unclosed'
 *   status 'dropped:bad-yaml'
 *   status 'dropped:missing-fields'
 *   status 'dropped:bad-name'
 *   status 'error'                  → unreadable file, with the message
 *
 * A root that does not exist is reported as `exists: false` (that is normal,
 * not an error). Entries that are neither `*.md`, `*.md.disabled` nor a
 * directory carrying `SKILL.md` land in `root.ignored` with the reason, so the
 * count always reconciles.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { judgeSkillFile, STATUS } from './frontmatter.js';
import { classifyEntryPath, resolveRoots } from './roots.js';

const DISABLED_SUFFIX = '.disabled';
/**
 * 「四态」：一个技能对模型和对人是两个独立的开关。
 *
 *   on          两者都能用（frontmatter 什么都没写）
 *   user-only   disable-model-invocation: true —— 只有人能用
 *   model-only  user-invocable: false        —— 只有模型能用
 *   off         入口文件已改名（.disabled），物理不存在
 *
 * 真值判定按 YAML 宽松解释：布尔 true 或字符串 'true' 都算；缺省 = 开。
 * 两个开关同时关掉也归为 off —— 效果上和彻底关掉没有差别。
 */
export function skillMode(enabled, raw) {
  if (enabled === false) return 'off';
  const data = raw && typeof raw === 'object' ? raw : {};
  const modelOff = isTruthy(data['disable-model-invocation']);
  const userOff = isFalsy(data['user-invocable']);
  if (modelOff && userOff) return 'off';
  if (modelOff) return 'user-only';
  if (userOff) return 'model-only';
  return 'on';
}

function isTruthy(value) {
  return value === true || value === 'true' || value === 'True' || value === 'TRUE';
}

function isFalsy(value) {
  return value === false || value === 'false' || value === 'False' || value === 'FALSE';
}

function entryKind(fullPath, dirent) {
  if (dirent.isDirectory()) return 'directory';
  if (dirent.isFile()) return 'file';
  if (!dirent.isSymbolicLink()) return 'other';
  try {
    const info = statSync(fullPath);
    if (info.isDirectory()) return 'directory';
    if (info.isFile()) return 'file';
    return 'other';
  } catch {
    return 'other';
  }
}

function readText(path) {
  try {
    return { text: readFileSync(path, 'utf8'), bytes: statSync(path).size };
  } catch (error) {
    return { error: error?.message ?? String(error) };
  }
}

function entryFor(root, relEntry, info) {
  // info = {form, enabled, entryName, enabledName, filePath, enabledPath, entryPath}
  const base = {
    name: info.fallbackName,
    description: '',
    source: root.source,
    rank: root.rank,
    rootPath: root.path,
    form: info.form,
    entryName: info.entryName,
    enabledName: info.enabledName,
    filePath: info.filePath,
    enabledPath: info.enabledPath,
    entryPath: info.entryPath,
    relEntry,
    enabled: info.enabled,
    writable: root.writable === true,
    bytes: 0,
    status: STATUS.OK,
    reason: undefined,
  };
  const read = readText(info.filePath);
  if (read.error !== undefined) {
    return { ...base, status: STATUS.READ_ERROR, reason: read.error };
  }
  base.bytes = read.bytes;
  const judged = judgeSkillFile(read.text);
  if (judged.status !== STATUS.OK) {
    return { ...base, status: judged.status, reason: judged.reason };
  }
  return {
    ...base,
    status: STATUS.OK,
    name: judged.name,
    description: judged.description,
    whenToUse: judged.whenToUse,
    mode: skillMode(base.enabled, judged.raw),
    reason: undefined,
  };
}

/**
 * @param {object} options same shape as resolveRoots(), plus:
 * @param {number|undefined} options.maxBodyBytes
 * @returns {object} the panel report
 */
export function scanSkills(options = {}) {
  const roots = resolveRoots(options);
  const skills = [];
  const rootReports = [];

  for (const root of roots) {
    const report = {
      source: root.source,
      rank: root.rank,
      path: root.path,
      configured: root.configured,
      exists: root.exists,
      writable: root.writable,
      skipSystem: root.skipSystem === true,
      trustedHost: root.trustedHost === true,
      note: root.note,
      projectRoot: root.projectRoot,
      skillCount: 0,
      enabledCount: 0,
      disabledCount: 0,
      ignored: [],
    };

    if (root.path === null) {
      rootReports.push(report);
      continue;
    }
    if (!report.exists) {
      rootReports.push(report);
      continue;
    }

    let entries;
    try {
      entries = readdirSync(root.path, { withFileTypes: true });
    } catch (error) {
      report.ignored.push({ name: '(readdir)', reason: error?.message ?? String(error) });
      rootReports.push(report);
      continue;
    }

    for (const dirent of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (root.skipSystem === true && dirent.name === '.system') {
        report.ignored.push({ name: dirent.name, reason: 'skipSystem（user-dsh 跳过 .system）' });
        continue;
      }
      const entryPath = join(root.path, dirent.name);
      const kind = entryKind(entryPath, dirent);

      if (kind === 'directory') {
        const livePath = join(entryPath, 'SKILL.md');
        const parkedPath = manyDisabled(entryPath);
        const live = existsSync(livePath);
        const parked = !live && parkedPath !== undefined;
        if (!live && !parked) {
          const extra =
            parkedPath === undefined
              ? '目录里没有 SKILL.md（不被当成技能）'
              : '目录里只有 SKILL.md.disabled（已停用）';
          report.ignored.push({ name: dirent.name, reason: extra });
          continue;
        }
        const info = {
          form: 'dir-bundle',
          enabled: live,
          entryName: live ? 'SKILL.md' : 'SKILL.md.disabled',
          enabledName: 'SKILL.md',
          filePath: live ? livePath : parkedPath,
          enabledPath: livePath,
          entryPath,
          fallbackName: dirent.name,
        };
        const row = entryFor(root, dirent.name, info);
        skills.push(row);
        report.skillCount += 1;
        if (row.enabled) report.enabledCount += 1;
        else report.disabledCount += 1;
        continue;
      }

      if (kind !== 'file') {
        report.ignored.push({ name: dirent.name, reason: `${kind} 类型条目（不是技能）` });
        continue;
      }

      const flat = classifyEntryPath(root.path, entryPath, root.skipSystem === true);
      if (flat === undefined) {
        report.ignored.push({
          name: dirent.name,
          reason: dirent.name.endsWith('.md') || dirent.name.endsWith('.md.disabled')
            ? '不在根的第一层（≤2 层约定）'
            : '不是 .md / .md.disabled 文件',
        });
        continue;
      }
      const info = {
        form: 'flat-md',
        enabled: flat.enabled,
        entryName: flat.entryName,
        enabledName: flat.enabledName ?? flat.entryName,
        filePath: entryPath,
        enabledPath: flat.enabled ? entryPath : join(root.path, flat.enabledName),
        entryPath: root.path,
        fallbackName: (flat.enabledName ?? flat.entryName).replace(/\.md$/, ''),
      };
      const row = entryFor(root, dirent.name, info);
      skills.push(row);
      report.skillCount += 1;
      if (row.enabled) report.enabledCount += 1;
      else report.disabledCount += 1;
    }

    rootReports.push(report);
  }

  // A skill only reaches the model as an enabled entry whose frontmatter
  // parsed. Mark cross-root shadows: the registry keeps the lowest rank, and
  // inside a root the first name in sort order wins.
  const live = skills
    .filter((s) => s.enabled && s.status === STATUS.OK)
    .sort((a, b) => a.rank - b.rank || a.entryName.localeCompare(b.entryName));
  const seen = new Map();
  for (const row of live) {
    const key = row.name;
    if (!seen.has(key)) {
      seen.set(key, row);
      continue;
    }
    row.shadowed = true;
    row.shadowedBy = seen.get(key).filePath;
  }

  skills.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));

  const okEnabled = skills.filter((s) => s.enabled && s.status === STATUS.OK);
  const summary = {
    rootsConfigured: rootReports.filter((r) => r.configured !== false).length,
    rootsMounted: rootReports.filter((r) => r.path !== null).length,
    rootsPresent: rootReports.filter((r) => r.exists).length,
    totalEntries: skills.length,
    enabled: skills.filter((s) => s.enabled).length,
    disabled: skills.filter((s) => !s.enabled).length,
    ok: skills.filter((s) => s.status === STATUS.OK).length,
    dropped: skills.filter((s) => s.status.startsWith('dropped:')).length,
    errors: skills.filter((s) => s.status === STATUS.ERROR).length,
    visibleToModel: okEnabled.filter((s) => s.shadowed !== true && s.mode !== 'user-only').length,
    shadowed: skills.filter((s) => s.shadowed === true).length,
  };

  return {
    generatedAt: new Date().toISOString(),
    cwd: options.cwd ?? null,
    projectRoot: options.cwd ? (roots.find((r) => r.projectRoot)?.projectRoot ?? null) : null,
    includeDefaultRoots: options.includeDefaultRoots !== false,
    roots: rootReports,
    skills,
    summary,
    // 顶层平铺三个最常用的数字：界面上到处要读，不该逼每个消费者都去翻 summary。
    // summary 里同名保留（老消费者不受影响）。
    totalEntries: summary.totalEntries,
    visibleToModel: summary.visibleToModel,
    dropped: summary.dropped,
    environment: {
      DSH_HOME: options.env?.DSH_HOME ?? process.env.DSH_HOME ?? null,
      DSH_BUNDLED_SKILL_DIR:
        options.env?.DSH_BUNDLED_SKILL_DIR ?? process.env.DSH_BUNDLED_SKILL_DIR ?? null,
    },
  };
}

function manyDisabled(dir) {
  const parked = join(dir, `SKILL.md${DISABLED_SUFFIX}`);
  return existsSync(parked) ? parked : undefined;
}

/** Read one entry file (read-only) for the panel's body preview. */
export function readSkillBody(filePath, maxBytes = 262144) {
  if (typeof filePath !== 'string' || filePath === '') {
    return { ok: false, error: '缺少 filePath' };
  }
  if (!existsSync(filePath)) return { ok: false, error: '文件不存在（可能刚被改名）' };
  const info = statSync(filePath);
  if (!info.isFile()) return { ok: false, error: '不是文件' };
  if (info.size > maxBytes) {
    const text = readFileSync(filePath, { encoding: 'utf8' }).slice(0, maxBytes);
    return { ok: true, truncated: true, bytes: info.size, text };
  }
  return { ok: true, truncated: false, bytes: info.size, text: readFileSync(filePath, 'utf8') };
}
