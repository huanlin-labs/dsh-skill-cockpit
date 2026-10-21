/**
 * dsh-skill-panel · 预设技能组
 *
 * 预设 = 一套跨分类的「技能 → 四态」清单。它不按目录分组、不按根分组，
 * 就是把不同地方的技能点在一起，一键切过去。
 *
 * 两个作用范围语义（`preset.scope`）：
 *
 *   'listed'     只改清单里列出的技能，清单外一概不动。（默认）
 *   'exclusive'  清单当白名单：清单外全部关掉（改名 → .disabled）。
 *
 * 为什么默认是 listed：exclusive 一次可能关掉二十多个技能，属于
 * 「一键把家改了」的级别。它可以有，但不能是默认值，界面上必须二次确认。
 *
 * 本文件是**纯函数**：不读盘、不写盘、不碰 fs。
 * 应用预设的真实写盘由 toggle.js 的 setSkillMode 一条条做（每条都有备份）。
 */

export const PRESET_MODES = Object.freeze(['on', 'user-only', 'model-only', 'off']);

/** 生成一个稳定的 id（不依赖 crypto，避免在渲染环境里取不到）。 */
export function newPresetId(existing = []) {
  const used = new Set(existing.map((p) => p && p.id).filter(Boolean));
  for (let i = 1; i < 10000; i += 1) {
    const id = `p${i}`;
    if (!used.has(id)) return id;
  }
  return `p${Date.now()}`;
}

/**
 * 清洗一条预设：丢掉认不出的 mode、丢掉没有 filePath 的项、按 filePath 去重。
 * 保留顺序（用户排的顺序就是他心里的大小顺序）。
 * @returns {{id:string,name:string,scope:string,items:Array<{filePath:string,mode:string}>}|{error:string}}
 */
export function normalizePreset(raw) {
  if (!raw || typeof raw !== 'object') return { error: '预设不是一个对象' };
  const id = typeof raw.id === 'string' && raw.id.trim() !== '' ? raw.id.trim() : '';
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (name === '') return { error: '预设没有名字' };
  const scope = raw.scope === 'exclusive' ? 'exclusive' : 'listed';
  const items = [];
  const seen = new Set();
  const list = Array.isArray(raw.items) ? raw.items : [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const filePath = typeof item.filePath === 'string' ? item.filePath.trim() : '';
    if (filePath === '' || seen.has(filePath)) continue;
    const mode = PRESET_MODES.includes(item.mode) ? item.mode : 'on';
    seen.add(filePath);
    items.push({ filePath, mode });
  }
  if (items.length === 0) return { error: '预设是空的（至少要有一个技能）' };
  return { id: id || newPresetId(), name, scope, items };
}

/**
 * 算「应用这个预设会发生什么」—— 只看不写。
 *
 * @param {object} preset 已 normalize 的预设
 * @param {Array} skills  scan.js 报出来的技能列表
 * @param {object} opts   { writableRoots?: string[] } 目前只用 skills[].writable
 * @returns {{
 *   steps: Array<{filePath:string,name:string,from:string,to:string}>,
 *   unchanged: number,
 *   missing: Array<{filePath:string,name:string}>,
 *   blocked: Array<{filePath:string,name:string,reason:string}>,
 *   exclusiveOff: Array<{filePath:string,name:string}>,
 * }}
 */
export function planPreset(preset, skills, opts = {}) {
  const list = Array.isArray(skills) ? skills : [];
  const byPath = new Map();
  for (const skill of list) {
    if (skill && typeof skill.filePath === 'string') byPath.set(skill.filePath, skill);
  }
  const steps = [];
  const missing = [];
  const blocked = [];
  let unchanged = 0;

  const modeOf = (skill) => {
    if (!skill) return 'off';
    if (skill.mode !== undefined) return skill.mode;
    return skill.enabled ? 'on' : 'off';
  };

  const listed = new Set();
  for (const item of preset.items) {
    listed.add(item.filePath);
    const skill = byPath.get(item.filePath);
    if (!skill) {
      missing.push({ filePath: item.filePath, name: item.filePath });
      continue;
    }
    const name = skill.name || skill.entryName || item.filePath;
    // 只有「入口文件」能被本插件改动；provider 技能、只读根一律挡下来。
    if (skill.writable !== true) {
      blocked.push({ filePath: item.filePath, name, reason: 'not-writable' });
      continue;
    }
    const from = modeOf(skill);
    if (from === item.mode) {
      unchanged += 1;
      continue;
    }
    steps.push({ filePath: item.filePath, name, from, to: item.mode });
  }

  const exclusiveOff = [];
  if (preset.scope === 'exclusive') {
    for (const skill of list) {
      if (!skill || typeof skill.filePath !== 'string') continue;
      if (listed.has(skill.filePath)) continue;
      if (skill.writable !== true) continue;
      if (modeOf(skill) === 'off') continue;
      exclusiveOff.push({ filePath: skill.filePath, name: skill.name || skill.entryName });
    }
  }

  return { steps, unchanged, missing, blocked, exclusiveOff };
}

/** 应用预设时一共要动多少个文件（给确认框用的一句话）。 */
export function countPresetWrites(plan) {
  return (plan?.steps?.length ?? 0) + (plan?.exclusiveOff?.length ?? 0);
}
