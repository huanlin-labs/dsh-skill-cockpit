/**
 * dsh-skill-panel · the on/off switch.
 *
 * The ONLY state this plugin ever writes is a single entry-file rename:
 *
 *   <dir>/SKILL.md            <->  <dir>/SKILL.md.disabled     (dir bundle)
 *   <root>/x.md               <->  <root>/x.md.disabled        (flat skill)
 *
 * Nothing else: no manifest, no prefs, no database. The switch state is read
 * back from the file name every time, so the panel can never claim "已关" while
 * the model can still load the skill.
 *
 * Hard guards (all of them refuse with a readable error):
 *   - the file must live directly inside a WRITABLE root (default: the
 *     user-level roots only — project-level roots are read-only by design,
 *     because writing into a workspace would bypass the workspace=permission
 *     boundary);
 *   - containment is re-checked on the REAL path (symlink/junction proof), the
 *     same `containedSegments` idea the provider uses;
 *   - only the entry file may be renamed — never a directory;
 *   - at most one target per call;
 *   - the destination must not already exist.
 */

import { existsSync, lstatSync, realpathSync, renameSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { containedSegments, resolveRoots } from './roots.js';

const DISABLED_SUFFIX = '.disabled';

function realOrSelf(path) {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * @param {object} request
 * @param {string} request.filePath  the entry file as the panel listed it
 * @param {boolean} request.disable  true = disable, false = re-enable
 * @param {boolean|undefined} request.plan  true = compute only, never rename
 * @param {object} options see resolveRoots()
 */
export function toggleSkill(request, options = {}) {
  const filePath = request?.filePath;
  const disable = request?.disable !== false;
  const planOnly = request?.plan === true;
  assert(typeof filePath === 'string' && filePath.trim() !== '', '缺少 filePath');

  const abs = resolve(filePath);
  assert(existsSync(abs), `文件不存在：${abs}`);
  const info = lstatSync(abs);
  assert(!info.isDirectory(), '拒绝：目标是目录（本插件永不改目录名）');
  assert(info.isFile() || info.isSymbolicLink(), '拒绝：目标不是普通文件');

  const roots = resolveRoots(options);
  const writable = roots.filter((r) => r.writable === true && typeof r.path === 'string');
  const target = realOrSelf(abs);

  let matched;
  let segments;
  for (const root of writable) {
    const rootReal = realOrSelf(root.path);
    const segs = containedSegments(rootReal, target);
    if (segs === undefined) continue;
    const name = segs.length === 0 ? '' : segs[segs.length - 1];
    const allowed =
      (segs.length === 1 && /\.md(\.disabled)?$/.test(name)) ||
      (segs.length === 2 && (name === 'SKILL.md' || name === `SKILL.md${DISABLED_SUFFIX}`));
    if (!allowed) continue;
    matched = root;
    segments = segs;
    break;
  }

  const insideAny = writable.some((root) => containedSegments(realOrSelf(root.path), target) !== undefined);
  if (matched === undefined) {
    if (insideAny) {
      throw new Error(
        '拒绝：只有技能入口文件（<目录>/SKILL.md 或 <根>/x.md）能改名，其它文件不动',
      );
    }
    const writableList = writable.map((r) => `${r.source} (${r.path})`).join(' · ') || '（无）';
    throw new Error(
      `拒绝：目标不在可写技能根内（项目级根只读）。可写根：${writableList}`,
    );
  }

  const currentName = basename(target);
  const parent = dirname(target);
  const isDisabledNow = currentName.endsWith(DISABLED_SUFFIX);

  if (disable && isDisabledNow) throw new Error('该技能已经是 .disabled，无需再停用');
  if (!disable && !isDisabledNow) throw new Error('该技能当前不是 .disabled，无需恢复');

  if (disable) {
    // Disabling appends the suffix, so the CURRENT name must be the live entry.
    assert(currentName.endsWith('.md'), `拒绝：被停用的名字不是 .md：${currentName}`);
  }
  const nextName = disable ? `${currentName}${DISABLED_SUFFIX}` : currentName.slice(0, -DISABLED_SUFFIX.length);
  if (!disable) {
    // Re-enabling strips the suffix, so the RESULT must be the live entry.
    assert(nextName.endsWith('.md'), `拒绝：恢复后的名字不是 .md：${nextName}`);
  }

  const dest = join(parent, nextName);
  assert(!existsSync(dest), `拒绝：目标已存在，避免覆盖：${dest}`);

  const result = {
    planned: true,
    source: matched.source,
    rank: matched.rank,
    rootPath: matched.path,
    segments,
    from: target,
    to: dest,
    disable,
  };
  if (planOnly) return { ...result, applied: false };

  // Re-verify the destination is still inside the same writable root right
  // before writing (nothing between the checks may widen the target).
  const destSegments = containedSegments(realOrSelf(matched.path), join(realOrSelf(parent), nextName));
  assert(destSegments !== undefined, '拒绝：目标路径逃逸出技能根');

  const before = statSync(target);
  renameSync(target, dest);
  const after = statSync(dest);
  assert(
    after.size === before.size,
    `改名后大小不一致（${before.size} → ${after.size}），请手工核对 ${dest}`,
  );

  return {
    ...result,
    planned: false,
    applied: true,
    bytes: after.size,
    mtimeMs: after.mtimeMs,
  };
}

/** Dry-run helper used by the panel's confirmation step and by the tests. */
export function planToggle(filePath, disable, options = {}) {
  return toggleSkill({ filePath, disable, plan: true }, options);
}
