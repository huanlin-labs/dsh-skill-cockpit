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

/** Same containment gate as the rename switch: the file must BE an entry file
 *  inside a WRITABLE root. Returns the root that claimed it. */
function claimEntry(target, options) {
  const roots = resolveRoots(options);
  const writable = roots.filter((r) => r.writable === true && typeof r.path === 'string');
  for (const root of writable) {
    const segs = containedSegments(realOrSelf(root.path), target);
    if (segs === undefined) continue;
    const name = segs.length === 0 ? '' : segs[segs.length - 1];
    const allowed =
      (segs.length === 1 && /\.md(\.disabled)?$/.test(name)) ||
      (segs.length === 2 && (name === 'SKILL.md' || name === `SKILL.md${DISABLED_SUFFIX}`));
    if (allowed) return { root, segments: segs };
  }
  const insideAny = writable.some((r) => containedSegments(realOrSelf(r.path), target) !== undefined);
  if (insideAny) {
    throw new Error('拒绝：只有技能入口文件（<目录>/SKILL.md 或 <根>/x.md）能改，其它文件不动');
  }
  const list = writable.map((r) => `${r.source} (${r.path})`).join(' · ') || '（无）';
  throw new Error(`拒绝：目标不在可写技能根内（项目级根只读）。可写根：${list}`);
}

/**
 * Four-state switch.
 *
 *   off        → delegate to the rename switch (physical removal)
 *   on / user-only / model-only → rewrite TWO frontmatter lines, nothing else
 *
 * Safety rules that are NOT optional (the owner approved this write, and the
 * approval was explicitly "change two lines, back each file up first"):
 *   1. the file must be UTF-8 — a byte round-trip check refuses anything else,
 *      because re-encoding a GBK/UTF-16 skill would silently mangle it;
 *   2. a timestamped `.bak-<stamp>` copy is written before the original is
 *      touched, and the backup must exist afterwards;
 *   3. the write goes through a temp file + rename, so a crash mid-write can
 *      never leave a half-written SKILL.md;
 *   4. `plan: true` computes everything and touches nothing.
 */
export function setSkillMode(request, options = {}) {
  const filePath = request?.filePath;
  const mode = request?.mode;
  const planOnly = request?.plan === true;
  assert(typeof filePath === 'string' && filePath.trim() !== '', '缺少 filePath');
  assert(
    mode === 'on' || mode === 'off' || mode === 'user-only' || mode === 'model-only',
    `未知的四态：${mode}`,
  );

  const abs = resolve(filePath);
  assert(existsSync(abs), `文件不存在：${abs}`);
  const info = lstatSync(abs);
  assert(!info.isDirectory(), '拒绝：目标是目录');
  assert(info.isFile() || info.isSymbolicLink(), '拒绝：目标不是普通文件');

  const target = realOrSelf(abs);
  const { root, segments } = claimEntry(target, options);
  const currentName = basename(target);

  // 'off' is the existing, proven rename path — never a second implementation.
  if (mode === 'off') {
    return { ...toggleSkill({ filePath: target, disable: true, plan: planOnly }, options), mode };
  }
  // 停用态可以直接切到任意一档：先把文件名恢复，再改 frontmatter。
  // 这里以前是一道「请先恢复到开启态」的墙 —— 结果是「关了再也开不回来」，
  // 因为四档里三档都被挡，用户只剩一条暗路（去文件管理器改名）。
  // 停用只是改名，改名可逆，没有理由把它变成墙。恢复动作放在真正写盘那一步，
  // 预览（plan）模式不留任何副作用。
  let workingPath = target;
  if (currentName.endsWith(DISABLED_SUFFIX)) {
    const restored = target.slice(0, -DISABLED_SUFFIX.length);
    assert(!existsSync(restored), `拒绝：恢复目标已存在，不敢覆盖：${restored}`);
    workingPath = restored;
  }

  const raw = readFileSync(target);
  const text = raw.toString('utf8');
  assert(
    Buffer.from(text, 'utf8').equals(raw),
    '拒绝：这个文件不是 UTF-8（重新编码会破坏内容），本插件不改它',
  );

  const next = applyModeToText(text, mode);
  if (next.error !== undefined) throw new Error(next.error);
  if (next.text === text) {
    return {
      planned: true,
      applied: false,
      changed: false,
      mode,
      source: root.source,
      from: target,
      segments,
    };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `${workingPath}.bak-${stamp}`;
  const result = {
    planned: planOnly,
    applied: false,
    changed: true,
    mode,
    source: root.source,
    rank: root.rank,
    rootPath: root.path,
    segments,
    from: workingPath,
    restoredFromDisabled: workingPath !== target,
    backup,
  };
  if (planOnly) return result;

  // 停用态切到其它档：先把文件名恢复，再照常备份 + 原子写。
  if (workingPath !== target) renameSync(target, workingPath);

  copyFileSync(workingPath, backup);
  assert(existsSync(backup), `备份没有写成功，已放弃：${backup}`);

  const tmp = `${workingPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, next.text, 'utf8');
  renameSync(tmp, workingPath);
  const after = statSync(workingPath);
  return { ...result, planned: false, applied: true, bytes: after.size, mtimeMs: after.mtimeMs };
}