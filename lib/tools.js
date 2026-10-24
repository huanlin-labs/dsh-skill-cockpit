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
import { listParked, purgeParked } from './parked.js';
import { listTrash, purgeTrash, restoreTrash } from './manage-trash.js';
import { readSkill, createSkill, updateSkill, deleteSkill } from './manage-write.js';
import { repairSkill } from './manage-repair.js';
import { backupAll, backupSkill } from './manage-backup.js';
import { toggleSkill } from './toggle.js';
import { scanSkills } from './scan.js';

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
];

const ACTION_HELP = {
  list: '列出全部技能（名字/来源/启用状态/路径）。参数：cwd 可选',
  read: '读一个技能的 SKILL.md（简介 + 正文）。参数：name（或 id=入口路径）',
  create: '新建技能（写 SKILL.md）。参数：name、description、body 可选',
  update: '改简介 / 正文 / 适用场景，自动备份旧文件。参数：name、description/body/whenToUse 至少一个',
  delete: '删除技能（整份进回收站，可还原）。参数：name、confirm=true',
  toggle: '启用 / 停用（只改入口文件名）。参数：name、disable=true 停用 / false 启用、plan 可选',
  repair: '修一个技能的结构问题。参数：name',
  backup: '备份技能（默认单个；all=true 备份全部）。参数：name 或 all',
  trash_list: '列出回收站（含更新暂存残壳）',
  trash_restore: '从回收站还原。参数：id（trash_list 返回的 id）',
  trash_purge: '彻底删除回收站条目。参数：id、confirm=true',
};

function describe(action) {
  return `${action}: ${ACTION_HELP[action] ?? '(未知动作)'}`;
}

function pickSkill(name) {
  const text = typeof name === 'string' ? name.trim() : '';
  return text;
}

export function createSkillTool({ cfg, scanOptions, managementRoots, managementRootFor, trashRootOf, home }) {
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
          const result = backupAll({ roots: managementRoots(cfg) });
          return { ok: true, action, summary: `已备份 ${result.count} 个技能到 ${result.dest}`, ...result };
        }
        const found = findRow(args.name, cwd);
        if (found.error) return { ok: false, error: found.error };
        const root = writeRootOf(found.row.filePath);
        const result = backupSkill({ filePath: found.row.filePath, root });
        return { ok: true, action, summary: `已备份 ${result.name} 到 ${result.dest}`, ...result };
      }

      if (action === 'create') {
        const result = createSkill({
          name: args.name,
          description: args.description,
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
        if (typeof args.description === 'string') patch.description = args.description;
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
    name: 'skill',
    description:
      '管理本机 agent 技能（技能 = 一个自带 SKILL.md 的目录）：查看、新建、修改、启停、删除、修复、备份、回收站。' +
      '用户提到某个技能要改 / 停 / 建 / 删时用它，不必打开面板。只写用户级技能根，项目级技能只读。',
    parameters: {
      action: {
        type: 'string',
        required: true,
        description: ACTIONS.map(describe).join('\n'),
      },
      name: { type: 'string', description: '技能名（目录名或 SKILL.md 的 name）' },
      id: { type: 'string', description: '回收站条目 id（trash_* 用）' },
      description: { type: 'string', description: '一句话简介（create / update）' },
      body: { type: 'string', description: 'SKILL.md 正文 markdown（create / update）' },
      whenToUse: { type: 'string', description: 'frontmatter 的 whenToUse（update）' },
      disable: { type: 'boolean', description: 'toggle：true=停用（默认），false=启用' },
      plan: { type: 'boolean', description: 'toggle：true 只预览不改名' },
      all: { type: 'boolean', description: 'backup：true 备份全部技能' },
      confirm: { type: 'boolean', description: 'delete / trash_purge 必须 true' },
      cwd: { type: 'string', description: '会话工作目录（决定项目级技能是否纳入扫描），通常不用填' },
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
