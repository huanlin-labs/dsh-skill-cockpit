/**
 * 工具层（0.12.0）：把「技能面板」的操作暴露给模型，让 dsh 可以被直接指挥改技能，
 * 不用点面板。与任务板同一套路：插件注册工具，模型调用即执行。
 *
 * 设计取舍（户主 2026-10-24 定）：
 *   - 只注册 **一个** 工具 `skill`，用 action 分派 —— 参数高度同构（name / body / confirm），
 *     拆成多个工具只是把同一套参数写几遍，白占每轮上下文。
 *   - 删除类（delete / trash_purge）必须带 confirm:true；删除前一律整份进回收站。
 *   - 只碰两个用户级可写根（~/.dsh/skills、~/.agents/skills）；项目级根只读。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { listParked, purgeParked } from './parked.js';
import { listTrash, purgeTrash, restoreTrash } from './manage-trash.js';
import { readSkill, createSkill, updateSkill, deleteSkill } from './manage-write.js';
import { repairSkill } from './manage-repair.js';
import { backupAll, backupSkill } from './manage-backup.js';
import { setSkillMode, toggleSkill } from './toggle.js';
import { scanSkills } from './scan.js';
import { addToVault, listVault, restoreFromVault } from './vault.js';
import { listAgentPresets, mountAgentSkill, unmountAgentSkill } from './agent-presets.js';
import { PRESET_MODES, countPresetWrites, planPreset } from './presets.js';
import { readStore, refreshUsage } from './usage.js';
import { analyzeSkills } from './checks.js';

const ACTIONS = [
  'list',
  'read',
  'create',
  'update',
  'delete',
  'toggle',
  'repair',
  'backup',
  'trash_list',
  'trash_restore',
  'trash_purge',
  // 0.13.0 二期：把面板里其余几块能力也交给模型
  'vault_list',
  'vault_put',
  'vault_install',
  'preset_list',
  'preset_mount',
  'preset_unmount',
  'mode_set',
  'usage',
  'checkup',
];

const ACTION_HELP = {
  list: '列出全部技能（名字/来源/启用状态/路径）。参数：cwd 可选',
  read: '读一个技能的 SKILL.md（简介 + 正文）。参数：name（或 id=入口路径）',
  create: '新建技能（写 SKILL.md）。参数：name、summary、body 可选',
  update: '改简介 / 正文 / 适用场景，自动备份旧文件。参数：name、summary/body/whenToUse 至少一个',
  delete: '删除技能（整份进回收站，可还原）。参数：name、confirm=true',
  toggle: '启用 / 停用（只改入口文件名）。参数：name、disable=true 停用 / false 启用、plan 可选',
  repair: '修一个技能的结构问题。参数：name',
  backup: '备份技能（默认单个；all=true 备份全部）。参数：name 或 all',
  trash_list: '列出回收站（含更新暂存残壳）',
  trash_restore: '从回收站还原。参数：id（trash_list 返回的 id）',
  trash_purge: '彻底删除回收站条目。参数：id、confirm=true',
  vault_list: '后备库名单 —— 只放「名字 + 从哪下」，不含技能文件；放进去 = 本机已删',
  vault_put: '把技能存进后备库 = 本机删除（整份进回收站）+ 名单记一行。参数：name、source（从哪下）、summary、confirm=true',
  vault_install: '按名单把技能装回来（来源是 git 地址就下载，是本机目录就复制）。参数：name',
  preset_list: '列出 DSH 预设（~/.dsh/.agent-presets）及各自挂着的技能',
  preset_mount: '把一个全局技能以 junction 挂进预设（重启 dsh 生效）。参数：presetId、name',
  preset_unmount: '摘掉预设里的一条 junction（只删链接，真实目录不动）。参数：presetId、name',
  mode_set: '批量切技能四态 on/user-only/model-only/off。参数：names（或 name）、mode、scope=listed|exclusive、confirm=true 才执行（不带只算给你看）',
  usage: '技能被调用次数（从会话日志统计）。参数：refresh=true 重新扫、maxFiles 可选',
  checkup: '体检：描述过短 / 目录名不符 / 正文疑似为空 / 同名被遮蔽',
};

function describe(action) {
  return `${action}: ${ACTION_HELP[action] ?? '(未知动作)'}`;
}

function pickSkill(name) {
  const text = typeof name === 'string' ? name.trim() : '';
  return text;
}

/** usage 扫多少份会话日志：调用方可覆盖，但夹在 1..500，兜底用配置值。 */
function positiveMaxFiles(value, fallback) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return Math.min(Math.floor(n), 500);
  return fallback;
}

export function createSkillTool({ cfg, scanOptions, managementRoots, managementRootFor, trashRootOf, backupRootOf, home }) {
  const listReport = (cwd) => scanSkills(scanOptions(cfg, cwd));

  const findRow = (name, cwd) => {
    const wanted = pickSkill(name);
    if (wanted === '') return { error: '缺少 name（技能名）。先 action=list 看看有哪些。' };
    const report = listReport(cwd);
    const rows = report.skills ?? [];
    const hit = rows.find((row) => row.name === wanted);
    if (hit) return { row: hit };
    const lower = wanted.toLowerCase();
    const loose = rows.filter((row) => String(row.name).toLowerCase().includes(lower));
    if (loose.length === 1) return { row: loose[0] };
    const names = rows.slice(0, 12).map((row) => row.name).join(', ');
    return {
      error: `找不到技能「${wanted}」。${loose.length > 1 ? `相近的有：${loose.map((r) => r.name).join(', ')}。` : ''}现有：${names}`,
    };
  };

  const writeRootOf = (filePath) => {
    const root = managementRootFor(cfg, filePath);
    if (root === null) throw new Error('拒绝：目标不在可写技能根内（项目级根只读）');
    return root;
  };

  /** 后备库名单：配置优先，否则 <dshHome>/skill-panel/后备库.md（与面板同一条规则）。 */
  const reserveListPath = () =>
    cfg.reserveListPath ? cfg.reserveListPath : join(home ?? '', 'skill-panel', '后备库.md');

  /** 用量索引文件：与 /usage 路由同一默认位置。 */
  const usageStorePath = () =>
    cfg.usageStorePath ? cfg.usageStorePath : join(home ?? '', 'dsh-skill-cockpit', 'usage.json');

  /** 可挂进 DSH 预设的池子 = 目录型技能（与面板 agentPool 同一口径）。 */
  const poolOf = (report) => {
    const pool = [];
    const seen = new Set();
    for (const row of report.skills ?? []) {
      if (row.form !== 'dir-bundle') continue;
      if (typeof row.name !== 'string' || row.name === '' || typeof row.entryPath !== 'string') continue;
      if (seen.has(row.name)) continue;
      seen.add(row.name);
      pool.push({ name: row.name, directory: row.entryPath, source: row.source });
    }
    return pool;
  };

  async function dispatch(args = {}) {
    const action = typeof args.action === 'string' ? args.action.trim() : '';
    if (!ACTIONS.includes(action)) {
      return { ok: false, error: `action 必须是 ${ACTIONS.join(' / ')} 之一。\n${ACTIONS.map(describe).join('\n')}` };
    }
    const cwd = typeof args.cwd === 'string' && args.cwd.trim() !== '' ? args.cwd : undefined;

    try {
      if (action === 'list') {
        const report = listReport(cwd);
        const rows = (report.skills ?? []).map((row) => ({
          name: row.name,
          enabled: row.enabled !== false,
          source: row.source,
          form: row.form,
          path: row.filePath,
          description: row.description,
        }));
        return {
          ok: true,
          action,
          count: rows.length,
          summary: `${rows.length} 个技能（启用 ${rows.filter((r) => r.enabled).length}）`,
          skills: rows,
        };
      }

      if (action === 'vault_list') {
        const listed = listVault({ listPath: reserveListPath() });
        const entries = (listed.entries ?? []).map((entry) => ({
          name: entry.name,
          description: entry.description,
          source: entry.source,
          size: entry.size,
          note: entry.note,
        }));
        return {
          ok: true,
          action,
          count: entries.length,
          listPath: listed.listPath,
          summary: listed.exists
            ? `后备库 ${entries.length} 条（名单：${listed.listPath}）`
            : `后备库名单还不存在（${listed.listPath}），还没存过技能`,
          entries,
        };
      }

      if (action === 'preset_list') {
        const report = listReport(cwd);
        const listed = listAgentPresets({ dshHome: home, pool: poolOf(report) });
        const presets = (listed.presets ?? []).map((preset) => ({
          id: preset.id,
          name: preset.name,
          description: preset.description,
          mounted: (preset.mounted ?? []).map((item) => ({
            name: item.name,
            link: item.link,
            hasSkill: item.hasSkill,
          })),
        }));
        return {
          ok: true,
          action,
          count: presets.length,
          root: listed.root,
          summary: presets.length === 0
            ? `没有 DSH 预设（${listed.root} 下没有预设文件夹）`
            : `${presets.length} 个 DSH 预设：${presets.map((p) => `${p.name}(${p.mounted.length})`).join('、')}`,
          presets,
        };
      }

      if (action === 'usage') {
        const storePath = usageStorePath();
        const refresh = args.refresh === true || !existsSync(storePath);
        const data = refresh
          ? refreshUsage({ dshHome: home, storePath, maxFiles: positiveMaxFiles(args.maxFiles, cfg.usageMaxFiles) })
          : readStore(storePath);
        const rows = (data.skills ?? []).slice(0, 40).map((row) => ({
          name: row.name,
          count: row.count,
          lastAt: typeof row.lastAt === 'number' ? new Date(row.lastAt).toISOString() : null,
        }));
        const total = rows.reduce((sum, row) => sum + (Number(row.count) || 0), 0);
        return {
          ok: true,
          action,
          refreshed: refresh,
          sessions: data.sessions ?? null,
          updatedAt: typeof data.updatedAt === 'number' ? new Date(data.updatedAt).toISOString() : null,
          count: rows.length,
          totalCalls: total,
          summary: rows.length === 0
            ? '会话日志里还没统计到技能调用（面板「用量」页也会显示 0）'
            : `共 ${total} 次技能调用，覆盖 ${rows.length} 个技能（最常用：${rows.slice(0, 3).map((r) => `${r.name}×${r.count}`).join('、')}）`,
          skills: rows,
        };
      }

      if (action === 'checkup') {
        const report = listReport(cwd);
        const result = analyzeSkills(report, {
          minDescriptionLength: cfg.minDescriptionLength,
          emptyBodyBytes: cfg.emptyBodyBytes,
        });
        const problems = (result.checks ?? []).slice(0, 40);
        return {
          ok: true,
          action,
          counts: result.summary,
          count: result.checks?.length ?? 0,
          summary: (result.summary?.total ?? 0) === 0
            ? `体检干净：${result.summary?.scanned ?? 0} 个技能都没发现问题`
            : `体检出 ${result.summary.total} 个问题（扫描 ${result.summary.scanned} 个技能）`,
          problems,
          note: result.note,
        };
      }

      if (action === 'trash_list') {
        const base = listTrash({ trashRoot: trashRootOf(cfg) });
        const parked = home ? listParked(home) : [];
        const entries = [...(base.entries ?? []), ...parked];
        return {
          ok: true,
          action,
          count: entries.length,
          summary: `回收站 ${entries.length} 条`,
          trashRoot: base.trashRoot,
          entries,
        };
      }

      if (action === 'trash_restore') {
        const id = String(args.id ?? '').trim();
        if (id === '') return { ok: false, error: '缺少 id（先用 action=trash_list 看条目）' };
        const preferred = managementRoots(cfg)[0];
        const result = restoreTrash({ trashRoot: trashRootOf(cfg), id, root: preferred });
        return { ok: true, action, summary: `已还原到 ${result.restored}`, ...result };
      }

      if (action === 'trash_purge') {
        if (args.confirm !== true) {
          return { ok: false, error: '彻底删除不可恢复，需要 confirm=true。若想保留，改用 trash_restore。' };
        }
        const id = String(args.id ?? '').trim();
        if (id === '') return { ok: false, error: '缺少 id（先用 action=trash_list 看条目）' };
        if (id.startsWith('parked:')) {
          const result = purgeParked(home, id.slice('parked:'.length));
          return { ok: true, action, summary: `已删除暂存残壳 ${result.purged}`, ...result };
        }
        const result = purgeTrash({ trashRoot: trashRootOf(cfg), id });
        return { ok: true, action, summary: `已彻底删除 ${result.purged}`, ...result };
      }

      if (action === 'backup') {
        if (args.all === true) {
          const result = backupAll({ roots: managementRoots(cfg), destRoot: backupRootOf(cfg) });
          return { ok: true, action, summary: `已备份 ${result.count} 个技能到 ${result.dest}`, ...result };
        }
        const found = findRow(args.name, cwd);
        if (found.error) return { ok: false, error: found.error };
        const root = writeRootOf(found.row.filePath);
        const result = backupSkill({ filePath: found.row.filePath, root, destRoot: backupRootOf(cfg) });
        return { ok: true, action, summary: `已备份 ${result.name} 到 ${result.dest}`, ...result };
      }

      if (action === 'vault_put') {
        if (args.confirm !== true) {
          return {
            ok: false,
            error: '存进后备库 = 本机删除（整份进回收站）+ 名单记一行，需要 confirm=true。',
          };
        }
        const found = findRow(args.name, cwd);
        if (found.error) return { ok: false, error: found.error };
        const root = writeRootOf(found.row.filePath);
        const result = addToVault({
          filePath: found.row.filePath,
          root,
          trashRoot: trashRootOf(cfg),
          listPath: reserveListPath(),
          description: typeof args.summary === 'string' ? args.summary : undefined,
          source: typeof args.source === 'string' ? args.source : undefined,
        });
        return {
          ok: true,
          action,
          summary: `已把 ${result.name} 收进后备库：本机已删除（回收站 ${result.deleted}）${result.recorded ? '，名单已记一行' : '，名单里本来就有这条'}`,
          ...result,
        };
      }

      if (action === 'vault_install') {
        const name = pickSkill(args.name);
        if (name === '') return { ok: false, error: '缺少 name（后备库里的名字，先 action=vault_list）' };
        const result = restoreFromVault({
          name,
          listPath: reserveListPath(),
          targetRoot: managementRoots(cfg)[0],
        });
        return {
          ok: true,
          action,
          summary: `已从后备库装回 ${result.name} → ${result.installed}（${result.via === 'git' ? 'git 下载' : '本机复制'}）`,
          ...result,
        };
      }

      if (action === 'preset_mount') {
        const presetId = String(args.presetId ?? '').trim();
        if (presetId === '') return { ok: false, error: '缺少 presetId（先 action=preset_list 看有哪些预设）' };
        const name = pickSkill(args.name);
        if (name === '') return { ok: false, error: '缺少 name（要挂进去的技能名）' };
        const result = mountAgentSkill({
          dshHome: home,
          presetId,
          skillName: name,
          pool: poolOf(listReport(cwd)),
        });
        if (result.ok !== true) return { ok: false, action, error: result.error ?? '挂载失败' };
        return {
          ok: true,
          action,
          restartRequired: true,
          summary: `已把 ${name} 挂进预设 ${presetId}（只建 junction，技能本体没动）—— 重启 dsh 后生效`,
          ...result,
        };
      }

      if (action === 'preset_unmount') {
        const presetId = String(args.presetId ?? '').trim();
        if (presetId === '') return { ok: false, error: '缺少 presetId（先 action=preset_list）' };
        const name = pickSkill(args.name);
        if (name === '') return { ok: false, error: '缺少 name（要从预设里摘掉的技能名）' };
        const result = unmountAgentSkill({ dshHome: home, presetId, skillName: name });
        if (result.ok !== true) return { ok: false, action, error: result.error ?? '摘除失败' };
        return {
          ok: true,
          action,
          restartRequired: true,
          summary: `已从预设 ${presetId} 摘掉 ${name}（只删链接，技能本体没动）—— 重启 dsh 后生效`,
          ...result,
        };
      }

      if (action === 'mode_set') {
        const mode = typeof args.mode === 'string' && args.mode.trim() !== '' ? args.mode.trim() : 'on';
        if (!PRESET_MODES.includes(mode)) {
          return { ok: false, error: `mode 必须是 ${PRESET_MODES.join(' / ')} 之一` };
        }
        const scope = args.scope === 'exclusive' ? 'exclusive' : 'listed';
        const names = (Array.isArray(args.names) ? args.names : [args.name])
          .map((value) => pickSkill(value))
          .filter((value) => value !== '');
        if (names.length === 0) return { ok: false, error: '缺少 names（要设置的技能名数组）或 name' };

        const report = listReport(cwd);
        const rows = report.skills ?? [];
        const items = [];
        const notFound = [];
        for (const wanted of names) {
          const hit =
            rows.find((row) => row.name === wanted) ??
            rows.find((row) => String(row.name).toLowerCase() === wanted.toLowerCase());
          if (hit) items.push({ filePath: hit.filePath, mode });
          else notFound.push(wanted);
        }
        if (items.length === 0) return { ok: false, error: `一个都没找到：${notFound.join('、')}` };

        const plan = planPreset({ id: 'mode_set', name: 'mode_set', scope, items }, rows);
        const writes = countPresetWrites(plan);
        const detail = {
          mode,
          scope,
          toChange: (plan.steps ?? []).map((step) => `${step.name}: ${step.from} → ${step.to}`),
          alreadyRight: plan.unchanged,
          notWritable: (plan.blocked ?? []).map((row) => row.name),
          exclusiveOff: (plan.exclusiveOff ?? []).map((row) => row.name),
          notFound,
        };
        if (args.confirm !== true) {
          return {
            ok: true,
            action,
            dryRun: true,
            writes,
            summary: `（没改盘）要改 ${writes} 个技能${notFound.length ? `，${notFound.length} 个没找到` : ''}；确认后带 confirm=true 再调一次`,
            plan: detail,
          };
        }

        const options = scanOptions(cfg, cwd);
        const applied = [];
        const failed = [];
        const runStep = (step) => {
          const result = setSkillMode({ filePath: step.filePath, mode: step.to }, options);
          applied.push({
            name: step.name,
            from: step.from,
            to: step.to,
            backup: typeof result?.backup === 'string' ? result.backup : null,
          });
        };
        for (const step of plan.steps ?? []) {
          try {
            runStep(step);
          } catch (error) {
            failed.push({ name: step.name, error: String(error?.message ?? error) });
            break;
          }
        }
        if (failed.length === 0) {
          for (const row of plan.exclusiveOff ?? []) {
            try {
              runStep({ filePath: row.filePath, name: row.name, from: 'on', to: 'off' });
            } catch (error) {
              failed.push({ name: row.name, error: String(error?.message ?? error) });
              break;
            }
          }
        }
        return {
          ok: failed.length === 0,
          action,
          writes,
          applied,
          failed,
          summary: failed.length === 0
            ? `已改 ${applied.length} 个技能（每个都留了 .bak 备份）`
            : `改到 ${failed[0]?.name} 时失败：${failed[0]?.error} —— 已改的 ${applied.length} 个不回滚`,
        };
      }

      if (action === 'create') {
        const result = createSkill({
          name: args.name,
          description: String(args.summary ?? args.description ?? ''),
          body: args.body,
          root: managementRoots(cfg)[0],
        });
        return { ok: true, action, summary: `已新建 ${result.name}：${result.filePath}`, ...result };
      }

      // 其余动作都先按名字定位
      const found = findRow(args.name, cwd);
      if (found.error) return { ok: false, error: found.error };
      const row = found.row;

      if (action === 'read') {
        const root = managementRootFor(cfg, row.filePath);
        if (root === null) {
          // 只读根（项目级 / 内置）没有写根，但仍允许读：退回其所在目录的父层不写。
          const { readFileSync } = await import('node:fs');
          const text = readFileSync(row.filePath, 'utf8');
          return { ok: true, action, name: row.name, path: row.filePath, text, summary: `${row.name}（只读根，原文）` };
        }
        const skill = readSkill({ filePath: row.filePath, root });
        return { ok: true, action, name: row.name, path: row.filePath, skill, summary: `已读 ${row.name}` };
      }

      if (action === 'update') {
        const root = writeRootOf(row.filePath);
        const patch = {};
        const desc = args.summary ?? args.description;
        if (typeof desc === 'string' && desc !== '') patch.description = desc;
        if (typeof args.body === 'string') patch.body = args.body;
        if (typeof args.whenToUse === 'string') patch.whenToUse = args.whenToUse;
        if (Object.keys(patch).length === 0) {
          return { ok: false, error: 'update 需要至少一个字段：description / body / whenToUse' };
        }
        const result = updateSkill({ filePath: row.filePath, root, ...patch });
        return { ok: true, action, summary: `已更新 ${row.name}（旧文件已备份）`, ...result };
      }

      if (action === 'delete') {
        if (args.confirm !== true) {
          return { ok: false, error: '删除会整份进回收站（可还原），但要 confirm=true 才执行。' };
        }
        const root = writeRootOf(row.filePath);
        const result = deleteSkill({ filePath: row.filePath, root, trashRoot: trashRootOf(cfg) });
        return { ok: true, action, summary: `已删除 ${row.name}，旧版本在回收站`, ...result };
      }

      if (action === 'toggle') {
        const root = writeRootOf(row.filePath);
        const result = toggleSkill(
          { filePath: row.filePath, disable: args.disable !== false, plan: args.plan === true },
          scanOptions(cfg, cwd),
        );
        const verb = result.applied ? (args.disable === false ? '已启用' : '已停用') : '预览';
        return { ok: true, action, summary: `${verb} ${row.name}：${result.from} → ${result.to}`, ...result };
      }

      if (action === 'repair') {
        const root = writeRootOf(row.filePath);
        const result = repairSkill({ filePath: row.filePath, root });
        return {
          ok: true,
          action,
          summary: result.changed ? `已修 ${row.name}：${(result.fixes ?? []).join('；')}` : `${row.name} 没发现问题`,
          ...result,
        };
      }

      return { ok: false, error: `未处理的动作：${action}` };
    } catch (error) {
      return { ok: false, action, error: String(error?.message ?? error) };
    }
  }

  const definition = {
    name: 'skill_panel',
    description:
      '管理本机 agent 技能（技能 = 一个自带 SKILL.md 的目录）：查看、新建、修改、启停、删除、修复、备份、回收站；' +
      '还有后备库（名单式卸载 / 装回）、DSH 预设挂载、批量切四态、用量统计、体检。' +
      '用户提到某个技能要改 / 停 / 建 / 删时用它，不必打开面板。只写用户级技能根，项目级技能只读。',
    // ctx.tools.register() 是裸注册：parameters 必须是**编译后的 JSON Schema**
    // （{type:'object', properties, required}），不会像 defineTool 那样帮我们编译。
    // 之前直接把「每参数一张卡」的 DSL 表塞进来，上游按 JSON Schema 校验：
    //   1) parameters 里叫 description 的键被当成注解关键字（必须字符串）→ 收到对象报错；
    //   2) 改名 summary 后，根节点又没有 type → 报 'type: null'。
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: ACTIONS.map(describe).join('\n') },
        name: { type: 'string', description: '技能名（目录名或 SKILL.md 的 name）' },
        names: { type: 'array', items: { type: 'string' }, description: 'mode_set：要设置的技能名列表（可替代 name）' },
        id: { type: 'string', description: '回收站条目 id（trash_* 用）' },
        summary: { type: 'string', description: '一句话简介（create / update / vault_put）' },
        body: { type: 'string', description: 'SKILL.md 正文 markdown（create / update）' },
        whenToUse: { type: 'string', description: 'frontmatter 的 whenToUse（update）' },
        source: { type: 'string', description: 'vault_put：从哪下（git 地址或本机目录），装回时按它取' },
        presetId: { type: 'string', description: 'DSH 预设 id（preset_mount / preset_unmount）' },
        mode: { type: 'string', enum: ['on', 'user-only', 'model-only', 'off'], description: 'mode_set：目标状态，默认 on' },
        scope: { type: 'string', enum: ['listed', 'exclusive'], description: 'mode_set：listed=只动清单里（默认），exclusive=清单当白名单，其余全关' },
        refresh: { type: 'boolean', description: 'usage：true 重新扫会话日志（默认只在没索引时扫）' },
        maxFiles: { type: 'number', description: 'usage：最多扫几份会话日志（1-500）' },
        disable: { type: 'boolean', description: 'toggle：true=停用（默认），false=启用' },
        plan: { type: 'boolean', description: 'toggle：true 只预览不改名' },
        all: { type: 'boolean', description: 'backup：true 备份全部技能' },
        confirm: { type: 'boolean', description: 'delete / trash_purge / vault_put / mode_set 必须 true 才执行' },
        cwd: { type: 'string', description: '会话工作目录（决定项目级技能是否纳入扫描），通常不用填' },
      },
      required: ['action'],
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => {
        const text = value && value.ok ? (value.summary ?? '完成') : `失败：${value?.error ?? '未知错误'}`;
        return [{ type: 'text', text }];
      },
    },
    execute: async (args) => dispatch(args),
  };

  return definition;
}

export { ACTIONS };
