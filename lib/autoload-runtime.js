/**
 * skill-cockpit · 自动加载 · 运行时胶水（1.1.0）
 *
 * 只做三件事，全部可测：
 *   1) 设置读写    ~/.dsh/skill-cockpit/autoload.json（总开关 / 档位 / 单技能关闭）
 *   2) 技能索引    扫描结果 + 正文（按 mtime 缓存，避免每轮读盘）
 *   3) pre-step    一轮对话进来 → 选出技能 → 造一条注入消息 → 插回消息数组
 *
 * 设计底线：这里任何异常都不许影响用户的对话。调用方（index.js）整体 try/catch，
 * 本文件内部也逐段兜底，最坏情况返回 null = 本轮什么都不做。
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  buildInjectedMessage,
  buildReminder,
  findLastUserIndex,
  insertInjected,
  normalizeSettings,
  readMessageText,
  selectSkills,
} from './autoload.js';

const BODY_CACHE = new Map(); // entryPath -> { mtimeMs, size, body }
const MAX_BODY_BYTES = 200 * 1024;

export function settingsPath(dshHome) {
  return join(dshHome, 'skill-cockpit', 'autoload.json');
}

export function readSettings(dshHome, fallback) {
  try {
    const file = settingsPath(dshHome);
    if (!existsSync(file)) return normalizeSettings(fallback);
    return normalizeSettings({ ...(fallback && typeof fallback === 'object' ? fallback : {}), ...JSON.parse(readFileSync(file, 'utf8')) });
  } catch {
    return normalizeSettings(fallback);
  }
}

/** 合并式写入：只改传进来的字段，其余保留。返回写入后的完整设置。 */
export function writeSettings(dshHome, patch) {
  const current = readSettings(dshHome);
  const next = normalizeSettings({ ...current, ...(patch && typeof patch === 'object' ? patch : {}) });
  const file = settingsPath(dshHome);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

/** 去掉 YAML frontmatter，只留正文（正文里再出现 --- 不处理，够用）。 */
export function stripFrontmatter(raw) {
  if (typeof raw !== 'string') return '';
  const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? raw.slice(m[0].length) : raw;
}

/** 读技能正文（带 mtime 缓存）。读不到返回 ''。 */
export function readSkillBody(entryPath) {
  try {
    const st = statSync(entryPath);
    const hit = BODY_CACHE.get(entryPath);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.body;
    if (st.size > MAX_BODY_BYTES) return '';
    const body = stripFrontmatter(readFileSync(entryPath, 'utf8'));
    BODY_CACHE.set(entryPath, { mtimeMs: st.mtimeMs, size: st.size, body });
    return body;
  } catch {
    return '';
  }
}

export function clearBodyCache() {
  BODY_CACHE.clear();
}

/**
 * 扫描结果 → 匹配用的技能列表。
 * @param {Array} rows  scanSkills() 的 report.skills
 * @param {object} [opt]
 * @param {boolean} [opt.withBody=true] 是否读正文（测试可关）
 */
export function indexFromRows(rows, { withBody = true } = {}) {
  const out = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row.name !== 'string' || row.name === '') continue;
    if (seen.has(row.name)) continue;
    if (typeof row.entryPath !== 'string') continue;
    seen.add(row.name);
    out.push({
      name: row.name,
      description: typeof row.description === 'string' ? row.description : '',
      enabled: row.enabled !== false,
      entryPath: row.entryPath,
      body: withBody ? readSkillBody(row.entryPath) : '',
    });
  }
  return out;
}

/**
 * 一轮 pre-step：判断要不要注入。返回 { messages, picked, text } 或 null（不注入）。
 * 不修改入参数组。
 */
export function planInjection({
  messages,
  skills,
  settings,
  alreadyInjected = [],
  maxSkills = 3,
} = {}) {
  if (!settings || settings.enabled !== true) return null;
  if (!Array.isArray(messages) || messages.length === 0) return null;
  if (!Array.isArray(skills) || skills.length === 0) return null;
  const at = findLastUserIndex(messages);
  if (at < 0) return null;
  const query = readMessageText(messages[at]);
  if (typeof query !== 'string' || query.trim() === '') return null;

  const { picked } = selectSkills({
    skills,
    query,
    tier: settings.tier,
    budgetBytes: settings.budgetBytes,
    perSkillOff: settings.perSkillOff,
    pinned: settings.pinned,
    alreadyInjected,
    maxSkills,
  });
  if (picked.length === 0) return null;
  const pinnedNames = Array.isArray(settings.pinned) ? settings.pinned.filter((n) => picked.some((p) => p.name === n)) : [];
  const text = buildReminder(picked, { reason: pinnedNames.length > 0 ? `本场必用（用户已指定）：${pinnedNames.join('、')}` : '' });
  if (text === '') return null;
  const injected = buildInjectedMessage(messages[at], text);
  return { messages: insertInjected(messages, injected), picked, text };
}

/** 诊断用：把一次 pre-step 的"看见什么"写盘（只在 settings.probe 时调用）。 */
export function writeProbe(dshHome, payload) {
  try {
    const file = join(dshHome, 'skill-cockpit', 'prestep-probe.json');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    return file;
  } catch {
    return null;
  }
}
