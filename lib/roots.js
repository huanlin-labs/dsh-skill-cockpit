/**
 * dsh-skill-panel · skill-root resolution.
 *
 * Faithful mirror of `@deepseek-ai/dsh-skill-filesystem` (v0.1.x, the package
 * that ships the filesystem skill provider) — see its `roots(cwd)`,
 * `Config` and `findProjectRoot`:
 *
 *   PROJECT_DSH_RANK 100  <projectRoot>/.dsh/skills      (skipSystem: no)
 *   PROJECT_AGENTS   200  <projectRoot>/.agents/skills
 *   CUSTOM           300  every configured customSkillDirs entry
 *   USER_DSH         400  <dshHome>/skills               (skipSystem: .system)
 *   USER_AGENTS      500  <agentsHome>/skills
 *   BUNDLED          600  bundledSkillDir                (trustedHost)
 *
 * Two facts this file exists to preserve:
 *  1. There are SIX root kinds, not four. Scanning only `~/.dsh/skills`
 *     under-reports what the model can actually load.
 *  2. `findProjectRoot` looks for a `.git` directory only (never `.dsh-root`),
 *     and falls back to cwd itself — so the skill list is session-scoped and a
 *     root may legitimately be absent for a given cwd.
 *
 * The bundled root comes from `config.bundledSkillDir`, else from
 * `$DSH_BUNDLED_SKILL_DIR` when default roots are included. When neither is
 * set the provider mounts NO bundled root — this module reports it as
 * `configured: false` instead of pretending the root exists.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const RANK = Object.freeze({
  'project-dsh': 100,
  'project-agents': 200,
  custom: 300,
  'user-dsh': 400,
  'user-agents': 500,
  bundled: 600,
});

/** Root kinds whose files this panel may rename (user-level, outside any project). */
export const DEFAULT_WRITABLE_SOURCES = Object.freeze(['user-dsh', 'user-agents']);

export function resolveDshHome(configured, env = process.env) {
  return resolve(configured ?? env.DSH_HOME ?? join(homedir(), '.dsh'));
}

export function resolveAgentsHome(configured, env = process.env) {
  return resolve(configured ?? env.DSH_AGENTS_HOME ?? join(homedir(), '.agents'));
}

/** Nearest ancestor (cwd included) containing `.git`; else cwd itself. */
export function findProjectRoot(cwd, exists = existsSync) {
  let current = resolve(cwd);
  for (;;) {
    if (exists(join(current, '.git'))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(cwd);
    current = parent;
  }
}

/**
 * @param {object} options
 * @param {string|undefined} options.cwd        session cwd; project roots need it
 * @param {string|undefined} options.dshHome
 * @param {string|undefined} options.agentsHome
 * @param {string[]|undefined} options.customSkillDirs
 * @param {string|undefined} options.bundledSkillDir
 * @param {boolean|undefined} options.includeDefaultRoots
 * @param {string[]|undefined} options.writableSources
 * @param {NodeJS.ProcessEnv|undefined} options.env
 * @returns {Array<object>} roots in rank order
 */
export function resolveRoots(options = {}) {
  const env = options.env ?? process.env;
  const includeDefaultRoots = options.includeDefaultRoots !== false;
  const dshHome = resolveDshHome(options.dshHome, env);
  const agentsHome = resolveAgentsHome(options.agentsHome, env);
  const writable = new Set(options.writableSources ?? DEFAULT_WRITABLE_SOURCES);
  const roots = [];

  const push = (source, path, extra = {}) => {
    roots.push({
      source,
      rank: RANK[source],
      path,
      exists: false,
      writable: writable.has(source),
      configured: true,
      skipSystem: false,
      trustedHost: false,
      ...extra,
    });
  };

  let projectRoot;
  if (includeDefaultRoots && options.cwd !== undefined && options.cwd !== null && options.cwd !== '') {
    projectRoot = findProjectRoot(options.cwd);
    push('project-dsh', join(projectRoot, '.dsh', 'skills'), { projectRoot });
    push('project-agents', join(projectRoot, '.agents', 'skills'), { projectRoot });
  }

  for (const dir of options.customSkillDirs ?? []) {
    if (typeof dir !== 'string' || dir.trim() === '') continue;
    push('custom', resolve(dir));
  }

  if (includeDefaultRoots) {
    push('user-dsh', join(dshHome, 'skills'), { skipSystem: true });
    push('user-agents', join(agentsHome, 'skills'));
  }

  const bundledRaw =
    options.bundledSkillDir ?? (includeDefaultRoots ? env.DSH_BUNDLED_SKILL_DIR : undefined);
  if (typeof bundledRaw === 'string' && bundledRaw.trim() !== '') {
    push('bundled', resolve(bundledRaw), { trustedHost: true });
  } else if (includeDefaultRoots) {
    // The provider mounts no bundled root here. Report that honestly rather
    // than silently shrinking the list.
    roots.push({
      source: 'bundled',
      rank: RANK.bundled,
      path: null,
      exists: false,
      writable: false,
      configured: false,
      skipSystem: false,
      trustedHost: true,
      note: '$DSH_BUNDLED_SKILL_DIR 未设置且未配置 bundledSkillDir ⇒ 提供方未挂载 bundled 根',
    });
  }

  roots.sort((a, b) => a.rank - b.rank);
  for (const root of roots) {
    if (root.path !== null) root.exists = existsSync(root.path);
  }
  return roots;
}

/**
 * Relative path segments of `path` under `root`, or undefined when `path`
 * escapes `root`. Same contract as the provider's `containedSegments`.
 */
export function containedSegments(root, path) {
  const child = relative(root, path);
  if (child.length === 0) return [];
  if (child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) return undefined;
  return child.split(sep);
}

/**
 * Discovery predicate mirrored from the provider: at most two levels, and
 * either `*.md` at the root (flat skill) or `<dir>/SKILL.md` (dir bundle).
 * `.disabled` names are accepted here on purpose — the panel lists them as
 * "已停用" instead of dropping them the way the runtime does.
 */
export function classifyEntryPath(root, path, skipSystem = false) {
  const segments = containedSegments(root, path);
  if (segments === undefined || segments.length === 0 || segments.length > 2) return undefined;
  if (skipSystem === true && segments[0] === '.system') return undefined;
  if (segments.length === 1) {
    const name = segments[0];
    if (name.endsWith('.md')) return { form: 'flat-md', enabled: true, entryName: name };
    if (name.endsWith('.md.disabled')) {
      return { form: 'flat-md', enabled: false, entryName: name, enabledName: name.slice(0, -'.disabled'.length) };
    }
    return undefined;
  }
  const name = segments[1];
  if (name === 'SKILL.md') return { form: 'dir-bundle', enabled: true, entryName: name };
  if (name === 'SKILL.md.disabled') {
    return { form: 'dir-bundle', enabled: false, entryName: name, enabledName: 'SKILL.md' };
  }
  return undefined;
}
