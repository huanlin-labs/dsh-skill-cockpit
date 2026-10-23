/**
 * dsh-skill-panel · HOST half.
 *
 * Serves the panel's read-only data over local HTTP routes and performs the
 * single write the panel is allowed to make (one entry-file rename).
 *
 *   GET  /__dsh-skill-panel/ping                 plugin identity + route list
 *   GET  /__dsh-skill-panel/skills?cwd=…         the full scan report
 *   GET  /__dsh-skill-panel/body?path=…&cwd=…    one entry file's text (read-only)
 *   GET  /__dsh-skill-panel/undeclared?q=…       search the not-installed index (read-only)
 *   GET  /__dsh-skill-panel/usage                skill invocation counts (0.3.0)
 *   GET  /__dsh-skill-panel/checks?cwd=…         "loads but earns nothing" diagnostics (0.3.0)
 *   POST /__dsh-skill-panel/toggle               { filePath, disable, cwd, plan? }
 *
 * TWO WRITES EXIST, BOTH APPROVED AND BOTH NARROW:
 *   · /toggle renames ONE entry file (SKILL.md ↔ SKILL.md.disabled) — content untouched.
 *   · /usage persists `<dshHome>/dsh-skill-cockpit/usage.json`, which holds skill
 *     NAMES, call counts and timestamps only. No message text, no titles, no cwd.
 *     The scan is incremental: an unchanged session log is skipped by (size, mtime).
 *
 * TWO REFUSALS ARE PART OF THE CONTRACT (0.3.1):
 *   · /body answers ONLY for entry files the /skills report listed for the same
 *     cwd; anything else is 403, so the route cannot be used as a file reader.
 *   · /toggle needs a resolvable cwd and a target inside the two user-level
 *     write roots (~/.dsh/skills, ~/.agents/skills). Project-level roots are
 *     read-only, and a missing cwd is refused instead of falling back to the
 *     global layer.
 *
 * `cwd` is what makes the answer session-scoped: project roots are derived from
 * it exactly like the skill provider does. Without it the panel reports the
 * user-level roots only and says so — it never guesses a cwd.
 *
 * Service access follows the house rule: `webServer` is optional (a
 * terminal-only profile has none), so it is taken through `ctx.get`, which is
 * cordis' documented safe accessor, and the plugin never blocks waiting for it.
 * Nothing else from `ctx` is touched — hence `inject` stays empty and this
 * package declares no @deepseek-ai/dsh* peer dependency at all.
 */

import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { scanSkills, readSkillBody } from './scan.js';
import { setSkillMode, toggleSkill } from './toggle.js';
import { detachAgentSkill, listAgentPresets, mountAgentSkill, unmountAgentSkill } from './agent-presets.js';
import { localizeDescription, skillZhMap } from './skill-zh.js';
import { normalizePreset, planPreset, countPresetWrites } from './presets.js';
import { DEFAULT_UNDECLARED_INDEX, indexStatus, searchUndeclared } from './undeclared.js';
import { refreshUsage } from './usage.js';
import { analyzeSkills } from './checks.js';
import { createSkill, deleteSkill, importSkill, readSkill, updateSkill } from './manage-write.js';
import { listTrash, purgeTrash, restoreTrash } from './manage-trash.js';
import { addToVault, assertListOutsideSkills, listVault, restoreFromVault } from './vault.js';
import { repairSkill } from './manage-repair.js';
import { backupAll, backupSkill } from './manage-backup.js';
import { createFromTemplate } from './manage-template.js';
import { containedSegments } from './roots.js';

export const name = 'dsh-skill-cockpit';
export const inject = [];

const VERSION = '0.10.0';
const BASE = '/__dsh-skill-panel';
const MAX_BODY = 1024 * 1024;

/** Usage lives next to the plugin's own data, never inside the skills tree. */
const USAGE_DIR = 'dsh-skill-cockpit';
const USAGE_FILE = 'usage.json';

/**
 * Which DSH home to scan for session logs. Config first, then the environment
 * the host itself uses, then `~/.dsh`. Never guessed from cwd: session logs are
 * per-home, not per-project.
 */
function resolveDshHome(configDshHome) {
  if (typeof configDshHome === 'string' && configDshHome.trim() !== '') return configDshHome;
  const fromEnv = process.env.DSH_HOME;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv;
  return join(homedir(), '.dsh');
}

/** Which agents home counts as the second (and last) writable root. */
function resolveAgentsHome(configAgentsHome) {
  if (typeof configAgentsHome === 'string' && configAgentsHome.trim() !== '') return configAgentsHome;
  const fromEnv = process.env.DSH_AGENTS_HOME;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv;
  return join(homedir(), '.agents');
}

/** Real path when it resolves, the input otherwise (a missing file is not fatal here). */
function realOrSelf(path) {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

/**
 * The ONLY two directories this panel may ever write into: the user-level
 * skill roots. Project-level roots are derived from the session cwd and stay
 * read-only by design (writing there would cross the workspace=permission
 * boundary), so they are deliberately absent from this list.
 */
function writableRootList(cfg) {
  const roots = [{ source: 'user-dsh', path: join(resolve(resolveDshHome(cfg.dshHome)), 'skills') }];
  // 第二个根是跨工具通用约定（~/.agents/skills），属于可选：目录不存在就不列，
  // 免得每个新用户都看到一条“技能根不存在”的警告。
  const agentsSkills = join(resolve(resolveAgentsHome(cfg.agentsHome)), 'skills');
  if (existsSync(agentsSkills)) roots.push({ source: 'user-agents', path: agentsSkills });
  return roots;
}

/** V2 管理功能用的可写根（纯路径）。创建/导入只写第一个（~/.dsh/skills）。 */
function managementRoots(cfg) {
  return writableRootList(cfg).map((r) => r.path);
}

/** 目标文件属于哪个可写根；不属于任何可写根时返回 null。 */
function managementRootFor(cfg, filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') return null;
  const target = resolve(filePath);
  for (const root of managementRoots(cfg)) {
    if (containedSegments(resolve(root), target) !== undefined) return resolve(root);
  }
  return null;
}

/**
 * Resolve an OPTIONAL session cwd. The panel is also mounted as a standalone
 * page where no session (hence no cwd) exists; requiring one would break the
 * panel's own switch there. The real security boundary is the write-root check
 * below, not this — a missing cwd only means "no project-level roots to scan",
 * and those are read-only anyway. A cwd that does not resolve is treated as
 * absent rather than as an error.
 */
function resolveSessionCwd(rawCwd) {
  if (typeof rawCwd !== 'string' || rawCwd.trim() === '') return { cwd: undefined };
  try {
    return { cwd: realpathSync.native(resolve(rawCwd)) };
  } catch {
    return { cwd: undefined };
  }
}

/** True when `filePath` resolves inside one of the two allowed write roots. */
function insideWritableRoots(cfg, filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') return { ok: false };
  const target = realOrSelf(resolve(filePath));
  for (const root of writableRootList(cfg)) {
    const segments = containedSegments(realOrSelf(root.path), target);
    if (segments === undefined) continue;
    return { ok: true, source: root.source, rootPath: root.path, segments };
  }
  return { ok: false, roots: writableRootList(cfg).map((root) => `${root.source} (${root.path})`) };
}

function positiveInt(value) {
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function normalizeConfig(config) {
  const base = config && typeof config === 'object' ? config : {};
  // 本机覆盖（只存在于这台机器，不进 npm 包）：~/.dsh/skill-cockpit/local.json
  // 公开版永远走通用默认值；这里只用来保留老用户自己的体系（例如 D:\\回收站）。
  let local = {};
  try {
    const localPath = join(resolveDshHome(base.dshHome), 'skill-cockpit', 'local.json');
    if (existsSync(localPath)) local = JSON.parse(readFileSync(localPath, 'utf8'));
  } catch {
    local = {};
  }
  const raw = { ...local, ...base };
  return {
    dshHome: typeof raw.dshHome === 'string' ? raw.dshHome : undefined,
    trashRoot: typeof raw.trashRoot === 'string' && raw.trashRoot.trim() !== '' ? raw.trashRoot.trim() : undefined,
    agentsHome: typeof raw.agentsHome === 'string' ? raw.agentsHome : undefined,
    customSkillDirs: Array.isArray(raw.customSkillDirs)
      ? raw.customSkillDirs.filter((d) => typeof d === 'string')
      : [],
    bundledSkillDir: typeof raw.bundledSkillDir === 'string' ? raw.bundledSkillDir : undefined,
    includeDefaultRoots: raw.includeDefaultRoots !== false,
    writableSources: Array.isArray(raw.writableSources) && raw.writableSources.length > 0
      ? raw.writableSources
      : undefined,
    undeclaredIndexPath:
      typeof raw.undeclaredIndexPath === 'string' && raw.undeclaredIndexPath !== ''
        ? raw.undeclaredIndexPath
        : DEFAULT_UNDECLARED_INDEX,
    maxBodyBytes: Number.isInteger(raw.maxBodyBytes) && raw.maxBodyBytes > 0 ? raw.maxBodyBytes : 262144,
    // 0.3.0: where the usage index lives, how many session logs to consider, and
    // the two diagnostic thresholds. All optional — the defaults are the tested path.
    usageStorePath:
      typeof raw.usageStorePath === 'string' && raw.usageStorePath !== '' ? raw.usageStorePath : undefined,
    usageMaxFiles: positiveInt(raw.usageMaxFiles),
    minDescriptionLength: Number.isInteger(raw.minDescriptionLength) && raw.minDescriptionLength >= 0
      ? raw.minDescriptionLength
      : undefined,
    emptyBodyBytes: Number.isInteger(raw.emptyBodyBytes) && raw.emptyBodyBytes >= 0
      ? raw.emptyBodyBytes
      : undefined,
    // 0.7.0: 后备库（reserve vault）。留空 = <dshHome>/skill-vault。
    // 它必须在技能根之外，否则放进去的技能会被当"已安装"扫到。
    reserveDir: typeof raw.reserveDir === 'string' && raw.reserveDir.trim() !== '' ? raw.reserveDir : undefined,
    // 0.10.0: 后备库 = 一份名单文件（不是技能目录）。留空 = <dshHome>/skill-panel/后备库.md
    reserveListPath:
      typeof raw.reserveListPath === 'string' && raw.reserveListPath.trim() !== ''
        ? raw.reserveListPath.trim()
        : undefined,
  };
}

/** 全局技能库 = 扫描报告里的目录形态技能（只有目录里有 SKILL.md 的才能被 junction 挂进预设）。 */
function agentPool(report, zh = {}) {
  const pool = [];
  const seen = new Set();
  for (const row of report.skills ?? []) {
    if (row.form !== 'dir-bundle') continue;
    if (typeof row.name !== 'string' || row.name === '') continue;
    if (typeof row.entryPath !== 'string') continue;
    if (seen.has(row.name)) continue;
    seen.add(row.name);
    pool.push({
      name: row.name,
      directory: row.entryPath,
      source: row.source,
      enabled: row.enabled === true,
      description: localizeDescription(zh, row.name, typeof row.description === 'string' ? row.description : ''),
    });
  }
  return pool;
}

/** 后备库根：配置优先，否则 <dshHome>/skill-vault（新手没有工作区也能用）。 */
function trashRootOf(cfg) {
  if (cfg.trashRoot) return cfg.trashRoot
  return join(resolveDshHome(cfg.dshHome), 'skill-panel', 'trash')
}

function reserveListPathOf(cfg) {
  const home = resolveDshHome(cfg.dshHome)
  const file = cfg.reserveListPath ? cfg.reserveListPath : join(home, 'skill-panel', '后备库.md')
  return assertListOutsideSkills(file, writableRootList(cfg).map((r) => r.path))
}

function scanOptions(cfg, cwd) {
  return {
    cwd: typeof cwd === 'string' && cwd.trim() !== '' ? cwd : undefined,
    dshHome: cfg.dshHome,
    agentsHome: cfg.agentsHome,
    customSkillDirs: cfg.customSkillDirs,
    bundledSkillDir: cfg.bundledSkillDir,
    includeDefaultRoots: cfg.includeDefaultRoots,
    writableSources: cfg.writableSources,
  };
}

/** Light local fence: this API is for the DSH window on this machine. */
function isLocalRequest(req) {
  const origin = req?.headers?.origin;
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return true;
  try {
    const url = new URL(origin);
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
  } catch {
    return false;
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (text.trim() === '') return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(new Error(`请求体不是合法 JSON：${error?.message ?? String(error)}`));
      }
    });
    req.on('error', reject);
  });
}

export function apply(ctx, config) {
  const cfg = normalizeConfig(config);
  console.log(`[dsh-skill-panel] host half loaded (v${VERSION})`);

  const send = (res, status, payload) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(payload));
  };

  const routes = [
    {
      method: 'GET',
      path: `${BASE}/ping`,
      handler: async () => ({
        ok: true,
        name,
        version: VERSION,
        routes: [
          `GET ${BASE}/ping`,
          `GET ${BASE}/skills`,
          `GET ${BASE}/body`,
          `GET ${BASE}/undeclared`,
          `GET ${BASE}/usage`,
          `GET ${BASE}/checks`,
          `POST ${BASE}/toggle`,
          `GET ${BASE}/presets`,
          `POST ${BASE}/presets/mount`,
          `POST ${BASE}/presets/unmount`,
          `POST ${BASE}/presets/detach`,
        ],
        writableSources: cfg.writableSources ?? ['user-dsh', 'user-agents'],
        undeclaredIndex: indexStatus(cfg.undeclaredIndexPath),
      }),
    },
    {
      method: 'GET',
      path: `${BASE}/skills`,
      handler: async (_req, _res, url) => scanSkills(scanOptions(cfg, url.searchParams.get('cwd'))),
    },
    {
      // Skill usage, distilled from the session logs. Incremental, so a second
      // call in the same minute only re-reads the sessions that actually grew.
      method: 'GET',
      path: `${BASE}/usage`,
      handler: async () => {
        const dshHome = resolveDshHome(cfg.dshHome);
        const storePath = cfg.usageStorePath ?? join(dshHome, USAGE_DIR, USAGE_FILE);
        // 技能说明只用来给人看：从同名技能入口的 frontmatter 取，取不到就空着。
        const descriptions = new Map();
        try {
          const report = scanSkills(scanOptions(cfg));
          for (const row of report.skills ?? []) {
            if (typeof row.name === 'string' && typeof row.description === 'string') {
              descriptions.set(row.name, row.description);
            }
          }
        } catch {
          // 扫描失败不影响用量数字本身
        }
        try {
          const result = refreshUsage({ dshHome, storePath, maxFiles: cfg.usageMaxFiles });
          return {
            ok: true,
            // Only these three fields per skill ever leave this function.
            skills: result.skills.map((row) => ({
              name: row.name,
              count: row.count,
              lastAt: typeof row.lastAt === 'number' ? row.lastAt : null,
              description: localizeDescription(skillZhMap(dshHome), row.name, descriptions.get(row.name) ?? ''),
            })),
            scanned: result.scanned,
            skipped: result.skipped,
            sessions: result.sessions,
            updatedAt: result.updatedAt,
            dshHome,
            storePath,
            privacy: '只存技能名 / 调用次数 / 时间戳，不存任何对话内容',
          };
        } catch (error) {
          return { ok: false, error: `读取会话日志失败：${error?.message ?? String(error)}` };
        }
      },
    },
    {
      // "Loads but earns nothing": pure analysis of the scan report, no disk I/O
      // of its own (the report already carries everything).
      method: 'GET',
      path: `${BASE}/checks`,
      handler: async (_req, _res, url) => {
        const report = scanSkills(scanOptions(cfg, url.searchParams.get('cwd')));
        const result = analyzeSkills(report, {
          minDescriptionLength: cfg.minDescriptionLength,
          emptyBodyBytes: cfg.emptyBodyBytes,
        });
        return { ...result, cwd: report.cwd, scannedSkills: report.summary?.totalEntries ?? 0 };
      },
    },
    {
      // Reading a file is the one place where "the caller asked" is not enough:
      // the answer is a whitelist, and the whitelist is the /skills report for
      // the SAME cwd. A path that the report never listed is refused with 403,
      // so this route can never be turned into an arbitrary file reader.
      method: 'GET',
      path: `${BASE}/body`,
      handler: async (_req, _res, url) => {
        const filePath = url.searchParams.get('path');
        if (!filePath) return { ok: false, status: 400, error: '缺少 path 参数' };
        // `cwd` is optional: the standalone page has no session. Without it the
        // report simply has no project-level roots, so a project-level entry is
        // refused below — while every user-level entry still reads fine.
        const { cwd } = resolveSessionCwd(url.searchParams.get('cwd'));

        const report = scanSkills(scanOptions(cfg, cwd));
        const allowed = new Set();
        for (const skill of report.skills ?? []) {
          if (typeof skill.filePath === 'string') allowed.add(realOrSelf(resolve(skill.filePath)));
        }
        const wanted = realOrSelf(resolve(filePath));
        if (!allowed.has(wanted)) {
          return {
            ok: false,
            status: 403,
            error: cwd
              ? '拒绝：只允许读取 /skills 报告里出现过的技能入口文件'
              : '拒绝：该入口不在当前可见的技能报告里。项目级技能需要会话 cwd 才能校验，请从会话内打开',
            requestedPath: wanted,
          };
        }
        return readSkillBody(filePath, cfg.maxBodyBytes);
      },
    },
    {
      method: 'GET',
      path: `${BASE}/undeclared`,
      handler: async (_req, _res, url) =>
        searchUndeclared(cfg.undeclaredIndexPath, url.searchParams.get('q') ?? ''),
    },
    {
      method: 'POST',
      path: `${BASE}/toggle`,
      handler: async (req) => {
        const body = await readJsonBody(req);
        // ONE gate protects the write, and it does not depend on the caller:
        // the target must sit inside one of the TWO user-level write roots
        // (~/.dsh/skills, ~/.agents/skills). Project-level roots are read-only
        // here even when the report listed the file, because a cwd-derived path
        // must never become a write. `cwd` is optional: it only decides which
        // project roots the scan knows about, and those are read-only anyway —
        // requiring it would break the panel's own switch on the standalone page.
        const { cwd } = resolveSessionCwd(body.cwd);
        const gate = insideWritableRoots(cfg, body.filePath);
        if (!gate.ok) {
          const roots = (gate.roots ?? []).join(' · ') || '（无）';
          return {
            ok: false,
            status: 403,
            error: `拒绝：目标不在可写技能根内（项目级根只读）。可写根：${roots}`,
            requestedPath: typeof body.filePath === 'string' ? resolve(body.filePath) : null,
          };
        }

        const result = toggleSkill(
          { filePath: body.filePath, disable: body.disable !== false, plan: body.plan === true },
          scanOptions(cfg, cwd),
        );
        console.log(
          `[dsh-skill-panel] ${result.applied ? 'rename' : 'plan'} ${result.from} -> ${result.to}`,
        );
        return result;
      },
    },
    {
      method: 'POST',
      path: `${BASE}/mode`,
      handler: async (req) => {
        const body = await readJsonBody(req);
        const { cwd } = resolveSessionCwd(body.cwd);
        // Same gate as /toggle: only an entry file inside one of the two
        // user-level write roots may be rewritten. Project roots stay read-only.
        const gate = insideWritableRoots(cfg, body.filePath);
        if (!gate.ok) {
          const roots = (gate.roots ?? []).join(' · ') || '（无）';
          return {
            ok: false,
            status: 403,
            error: `拒绝：目标不在可写技能根内（项目级根只读）。可写根：${roots}`,
            requestedPath: typeof body.filePath === 'string' ? resolve(body.filePath) : null,
          };
        }
        const result = setSkillMode(
          { filePath: body.filePath, mode: body.mode, plan: body.plan === true },
          scanOptions(cfg, cwd),
        );
        console.log(
          `[dsh-skill-panel] mode ${result.applied ? 'apply' : 'plan'} ${result.mode} ${result.from}` +
            (typeof result.backup === 'string' ? ` (backup ${result.backup})` : ''),
        );
        return result;
      },
    },

    // ---- V2 管理功能（户主 2026-10-23 批准：创建 / 编辑 / 删除进回收站 / 导入） ----
    // 只碰两个用户级可写根；项目级根、只读根、非入口文件一律拒绝（与管理模块同一道门）。
    {
      method: 'POST',
      path: `${BASE}/skill/read`,
      handler: async (req) => {
        const body = await readJsonBody(req);
        const root = managementRootFor(cfg, body.filePath);
        if (root === null) return { ok: false, status: 403, error: '拒绝：目标不在可写技能根内' };
        try {
          return { ok: true, skill: readSkill({ filePath: body.filePath, root }) };
        } catch (error) {
          return { ok: false, status: 400, error: String(error?.message ?? error) };
        }
      },
    },
    {
      method: 'POST',
      path: `${BASE}/skill/create`,
      handler: async (req) => {
        const body = await readJsonBody(req);
        try {
          const result = body.template
          ? createFromTemplate({ name: body.name, description: body.description, template: body.template, root: managementRoots(cfg)[0] })
          : createSkill({ ...body, root: managementRoots(cfg)[0] });
          console.log(`[dsh-skill-panel] create ${result.filePath}`);
          return result;
        } catch (error) {
          return { ok: false, status: 400, error: String(error?.message ?? error) };
        }
      },
    },
    {
      method: 'POST',
      path: `${BASE}/skill/update`,
      handler: async (req) => {
        const body = await readJsonBody(req);
        const root = managementRootFor(cfg, body.filePath);
        if (root === null) return { ok: false, status: 403, error: '拒绝：目标不在可写技能根内' };
        try {
          const result = updateSkill({ ...body, root });
          console.log(`[dsh-skill-panel] update ${result.filePath} changed=${result.changed}`);
          return result;
        } catch (error) {
          return { ok: false, status: 400, error: String(error?.message ?? error) };
        }
      },
    },
    {
      method: 'POST',
      path: `${BASE}/skill/delete`,
      handler: async (req) => {
        const body = await readJsonBody(req);
        const root = managementRootFor(cfg, body.filePath);
        if (root === null) return { ok: false, status: 403, error: '拒绝：目标不在可写技能根内' };
        try {
          const result = deleteSkill({ filePath: body.filePath, root, trashRoot: trashRootOf(cfg) });
          console.log(`[dsh-skill-panel] delete ${result.skillDir ?? result.trashPath} -> ${result.trashPath}`);
          return result;
        } catch (error) {
          return { ok: false, status: 400, error: String(error?.message ?? error) };
        }
      },
    },
    {
      method: 'POST',
      path: `${BASE}/skill/import`,
      handler: async (req) => {
        const body = await readJsonBody(req);
        try {
          const result = importSkill({ ...body, root: managementRoots(cfg)[0] });
          console.log(`[dsh-skill-panel] import ${result.name} <- ${body.sourceDir}`);
          return result;
        } catch (error) {
          return { ok: false, status: 400, error: String(error?.message ?? error) };
        }
      },
    },

    {
      method: 'POST',
      path: `${BASE}/skill/repair`,
      handler: async (req) => {
        const body = await readJsonBody(req);
        try {
          const root = managementRootFor(cfg, body.filePath);
          if (root === null) return { ok: false, status: 403, error: '拒绝：目标不在可写技能根内' };
          const result = repairSkill({ filePath: body.filePath, root });
          if (result.changed) console.log(`[dsh-skill-panel] repair ${result.filePath} (${result.fixes.join('; ')})`);
          return result;
        } catch (error) {
          return { ok: false, status: 400, error: String(error?.message ?? error) };
        }
      },
    },
    {
      method: 'POST',
      path: `${BASE}/skill/backup`,
      handler: async (req) => {
        const body = await readJsonBody(req);
        try {
          if (body.all === true) {
            const roots = writableRootList(cfg);
            const result = backupAll({ roots });
            console.log(`[dsh-skill-panel] backup-all -> ${result.dest} (${result.count})`);
            return result;
          }
          const root = managementRootFor(cfg, body.filePath);
          if (root === null) return { ok: false, status: 403, error: '拒绝：目标不在可写技能根内' };
          const result = backupSkill({ filePath: body.filePath, root });
          console.log(`[dsh-skill-panel] backup ${result.name} -> ${result.dest}`);
          return result;
        } catch (error) {
          return { ok: false, status: 400, error: String(error?.message ?? error) };
        }
      },
    },
    {
      method: 'POST',
      path: `${BASE}/trash/list`,
      handler: async (req) => {
        const body = await readJsonBody(req);
        try {
          return listTrash({ trashRoot: trashRootOf(cfg) });
        } catch (error) {
          return { ok: false, status: 400, error: String(error?.message ?? error) };
        }
      },
    },
    {
      method: 'POST',
      path: `${BASE}/trash/restore`,
      handler: async (req) => {
        const body = await readJsonBody(req);
        try {
          const preferred = typeof body.root === 'string' && managementRootFor(cfg, body.root) ? body.root : managementRoots(cfg)[0];
          const result = restoreTrash({ ...body, root: preferred });
          console.log(`[dsh-skill-panel] restore ${result.name} -> ${result.restored}`);
          return result;
        } catch (error) {
          return { ok: false, status: 400, error: String(error?.message ?? error) };
        }
      },
    },
    {
      method: 'POST',
      path: `${BASE}/trash/purge`,
      handler: async (req) => {
        const body = await readJsonBody(req);
        try {
          const result = purgeTrash({ trashRoot: trashRootOf(cfg), id: body.id });
          console.log(`[dsh-skill-panel] purge ${result.purged}`);
          return result;
        } catch (error) {
          return { ok: false, status: 400, error: String(error?.message ?? error) };
        }
      },
    },

    {
      method: 'POST',
      path: `${BASE}/vault/list`,
      handler: async () => {
        try {
          return listVault({ listPath: reserveListPathOf(cfg) })
        } catch (error) {
          return { ok: false, status: 400, error: String(error?.message ?? error) }
        }
      },
    },
    {
      method: 'POST',
      path: `${BASE}/vault/move`,
      handler: async (req) => {
        const body = await readJsonBody(req);
        try {
          const root = managementRootFor(cfg, body.filePath);
          if (root === null) return { ok: false, status: 403, error: '拒绝：目标不在可写技能根内' };
          const result = addToVault({
            filePath: body.filePath,
            root,
            trashRoot: trashRootOf(cfg),
            listPath: reserveListPathOf(cfg),
            description: body.description,
            source: body.source,
          });
          console.log(`[dsh-skill-panel] vault-add ${result.name} -> ${result.deleted}`);
          return result;
        } catch (error) {
          return { ok: false, status: 400, error: String(error?.message ?? error) };
        }
      },
    },
    {
      method: 'POST',
      path: `${BASE}/vault/install`,
      handler: async (req) => {
        const body = await readJsonBody(req);
        try {
          const targetRoot = managementRoots(cfg)[0];
          const result = restoreFromVault({ name: body.name, listPath: reserveListPathOf(cfg), targetRoot });
          console.log(`[dsh-skill-panel] vault-install ${result.name} -> ${result.installed}`);
          return result;
        } catch (error) {
          return { ok: false, status: 400, error: String(error?.message ?? error) };
        }
      },
    },

    {
      method: 'POST',
      path: `${BASE}/preset/plan`,
      handler: async (req) => {
        const body = await readJsonBody(req);
        const { cwd } = resolveSessionCwd(body.cwd);
        const preset = normalizePreset(body.preset);
        if (preset.error) return { ok: false, status: 400, error: preset.error };
        // READ ONLY: 只算不写。真正应用预设是批量写盘，先让用户看清楚。
        const report = scanSkills(scanOptions(cfg, cwd));
        const plan = planPreset(preset, report.skills);
        return { ok: true, name: preset.name, plan, writes: countPresetWrites(plan) };
      },
    },
    {
      method: 'POST',
      path: `${BASE}/preset/apply`,
      handler: async (req) => {
        const body = await readJsonBody(req);
        const { cwd } = resolveSessionCwd(body.cwd);
        const preset = normalizePreset(body.preset);
        if (preset.error) return { ok: false, status: 400, error: preset.error };
        const options = scanOptions(cfg, cwd);
        const plan = planPreset(preset, scanSkills(options).skills);
        // 逐条执行：一条一条走 setSkillMode（每条都自带备份 + 原子写）。
        // 任何一条失败立刻停 —— 不带着错误继续改剩下的，那样最难收拾。
        const applied = [];
        const failed = [];
        for (const step of plan.steps) {
          try {
            const result = setSkillMode({ filePath: step.filePath, mode: step.to }, options);
            applied.push({
              name: step.name,
              from: step.from,
              to: step.to,
              backup: typeof result.backup === 'string' ? result.backup : null,
            });
          } catch (err) {
            failed.push({ name: step.name, error: err.message });
            break;
          }
        }
        console.log(
          `[dsh-skill-panel] preset ${preset.name}: ${applied.length} applied, ${failed.length} failed`,
        );
        return {
          ok: failed.length === 0,
          name: preset.name,
          applied,
          failed,
          remaining: plan.steps.length - applied.length - failed.length,
        };
      },
    },
    {
      // 预设页：列 DSH 预设 + 每个预设已挂的技能 + 全局技能库（只读枚举）
      method: 'GET',
      path: `${BASE}/presets`,
      handler: async (_req, _res, url) => {
        const { cwd } = resolveSessionCwd(url.searchParams.get('cwd'));
        const dshHome = resolve(resolveDshHome(cfg.dshHome));
        const report = scanSkills(scanOptions(cfg, cwd));
        const zh = skillZhMap(dshHome);
        const listed = listAgentPresets({ dshHome, pool: agentPool(report, zh) });
        for (const preset of listed.presets ?? []) {
          for (const skill of preset.skills ?? []) {
            skill.description = localizeDescription(zh, skill.name, skill.description ?? '');
          }
        }
        return { ...listed, dshHome, restartRequired: true, note: '挂载 / 卸载只做 junction；改完要重启 dsh 才生效' };
      },
    },
    {
      // 只建 junction：技能本体不动，预设里多一个指向它的链接
      method: 'POST',
      path: `${BASE}/presets/mount`,
      handler: async (req) => {
        const body = await readJsonBody(req);
        const { cwd } = resolveSessionCwd(body.cwd);
        const pool = agentPool(scanSkills(scanOptions(cfg, cwd)), skillZhMap(resolve(resolveDshHome(cfg.dshHome))));
        const result = mountAgentSkill({
          dshHome: resolve(resolveDshHome(cfg.dshHome)),
          presetId: body.presetId,
          skillName: body.skillName,
          pool,
        });
        console.log(`[dsh-skill-panel] preset mount ${body.presetId} <- ${body.skillName}: ${result.ok ? 'ok' : result.error}`);
        return { ...result, restartRequired: result.ok === true };
      },
    },
    {
      // 只删链接；预设里的真实目录一律拒绝
      method: 'POST',
      path: `${BASE}/presets/unmount`,
      handler: async (req) => {
        const body = await readJsonBody(req);
        const result = unmountAgentSkill({
          dshHome: resolve(resolveDshHome(cfg.dshHome)),
          presetId: body.presetId,
          skillName: body.skillName,
        });
        console.log(`[dsh-skill-panel] preset unmount ${body.presetId} -> ${body.skillName}: ${result.ok ? 'ok' : result.error}`);
        return { ...result, restartRequired: result.ok === true };
      },
    },
    {
      // 预设自带的真实目录：搬到全局技能库（技能不丢），预设就不再带它
      method: 'POST',
      path: `${BASE}/presets/detach`,
      handler: async (req) => {
        const body = await readJsonBody(req);
        const result = detachAgentSkill({
          dshHome: resolve(resolveDshHome(cfg.dshHome)),
          presetId: body.presetId,
          skillName: body.skillName,
        });
        console.log(`[dsh-skill-panel] preset detach ${body.presetId} -> ${body.skillName}: ${result.ok ? 'ok' : result.error}`);
        return { ...result, restartRequired: result.ok === true };
      },
    },
  ];

  const register = (host, targetCtx) => {
    for (const route of routes) {
      targetCtx.effect(() =>
        host.register({
          kind: 'exact',
          path: route.path,
          handler: async (req, res) => {
            let url;
            try {
              url = new URL(req.url ?? route.path, 'http://127.0.0.1');
            } catch {
              send(res, 400, { ok: false, error: '无法解析请求 URL' });
              return;
            }
            if (!isLocalRequest(req)) {
              send(res, 403, { ok: false, error: '只接受本机窗口的请求' });
              return;
            }
            if ((req.method ?? 'GET').toUpperCase() !== route.method) {
              send(res, 405, { ok: false, error: `method not allowed (use ${route.method})` });
              return;
            }
            try {
              const payload = await route.handler(req, res, url);
              // A handler that reports { ok: false } is a refusal: 400 for a bad
              // request, and its own `status` when it is a deliberate security
              // refusal (403). A handler never chooses 200 for a failure.
              const failed = payload !== null && typeof payload === 'object' && payload.ok === false;
              const status = failed && Number.isInteger(payload.status) ? payload.status : failed ? 400 : 200;
              send(res, status, payload);
            } catch (error) {
              send(res, 400, { ok: false, error: error?.message ?? String(error) });
            }
          },
        }),
      );
    }
  };

  const webServer = ctx.get('webServer');
  if (webServer !== undefined) {
    register(webServer, ctx);
  } else {
    // A profile without a web surface: wait for it instead of hanging.
    ctx.inject(['webServer'], (sub) => {
      register(sub.webServer, sub);
    });
  }
}
