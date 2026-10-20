/**
 * dsh-skill-panel · 诊断层（纯函数，绝不读磁盘）。
 *
 * 输入是 GET /__dsh-skill-panel/skills 返回的扫描报告（见 lib/scan.js），
 * 输出四类「能加载但白占坑」的问题，供 GET /__dsh-skill-panel/checks 使用：
 *
 *   1 shadowed           跨根重名，rank 更高的那份遮蔽了这份，模型永远看不到
 *   2 short-description  描述为空或过短（模型靠描述决定要不要用这个技能）
 *   3 dir-name-mismatch  目录名 ≠ frontmatter 里的 name（人肉找技能时极易找错）
 *   4 empty-body         文件字节数极小，正文疑似为空（只剩 frontmatter）
 *
 * 设计约束：
 *   · 本文件不 import node:fs，只做内存计算 —— 报告里已经带了全部所需字段；
 *   · 任何畸形输入都不抛异常，统一返回空结果且 ok: true（诊断本身不该成为新的故障源）；
 *   · 同一技能的同一类问题只报一次；checks 按固定 kind 顺序分组，保证输出稳定。
 */

/** 描述（trim 后）短于这个字数就报「描述为空或过短」 */
export const MIN_DESCRIPTION_LENGTH = 20;

/** 文件字节数小于这个值就报「正文疑似为空」 */
export const EMPTY_BODY_BYTES = 300;

/** 四类问题的机器名（给人看的中文文案见 CHECK_LABELS） */
export const CHECK_KINDS = {
  shadowed: 'shadowed',
  shortDescription: 'short-description',
  dirNameMismatch: 'dir-name-mismatch',
  emptyBody: 'empty-body',
};

/** 四类问题的中文标签 */
export const CHECK_LABELS = {
  [CHECK_KINDS.shadowed]: '跨根重名被遮蔽',
  [CHECK_KINDS.shortDescription]: '描述为空或过短',
  [CHECK_KINDS.dirNameMismatch]: '目录名≠技能名',
  [CHECK_KINDS.emptyBody]: '正文疑似为空',
};

/** checks 的固定分组顺序（与人的关注度一致：先看白占坑的，再看可以顺手改的） */
const KIND_ORDER = [
  CHECK_KINDS.shadowed,
  CHECK_KINDS.shortDescription,
  CHECK_KINDS.dirNameMismatch,
  CHECK_KINDS.emptyBody,
];

const NOTE = '正文长度按文件字节估计（启发式，不是精确正文长度）';

const DIR_BUNDLE = 'dir-bundle';
const STATUS_OK = 'ok';

// ---- 小工具（只碰字符串，不碰磁盘） ---------------------------------------

/** 路径末段：'C:\\a\\b\\SKILL.md' → 'SKILL.md'（同时容忍 / 与 \\、末尾斜杠） */
function lastSegment(path) {
  if (typeof path !== 'string') return '';
  const parts = path.split(/[\\/]+/).filter((part) => part !== '');
  return parts.length > 0 ? parts[parts.length - 1] : '';
}

/** 路径倒数第二段：'C:\\a\\b\\SKILL.md' → 'b' */
function parentSegment(path) {
  if (typeof path !== 'string') return '';
  const parts = path.split(/[\\/]+/).filter((part) => part !== '');
  return parts.length >= 2 ? parts[parts.length - 2] : '';
}

/**
 * dir-bundle 技能的「目录名」。
 * 首选 entryPath 的末段（原文即 .../技能目录）；缺失时退回 filePath 的 dirname 末段。
 */
function dirNameOf(skill) {
  const fromEntry = lastSegment(skill.entryPath);
  if (fromEntry !== '') return fromEntry;
  return parentSegment(skill.filePath);
}

/** 阈值兜底：非数字 / 负数 / NaN 一律回落默认值 */
function normalizeThreshold(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function emptyResult(thresholds) {
  return {
    ok: true,
    checks: [],
    summary: {
      total: 0,
      shadowed: 0,
      shortDescription: 0,
      dirNameMismatch: 0,
      emptyBody: 0,
      byKind: {
        [CHECK_KINDS.shadowed]: 0,
        [CHECK_KINDS.shortDescription]: 0,
        [CHECK_KINDS.dirNameMismatch]: 0,
        [CHECK_KINDS.emptyBody]: 0,
      },
      scanned: 0,
    },
    thresholds,
    note: NOTE,
  };
}

// ---- 主入口 ---------------------------------------------------------------

/**
 * 把扫描报告诊断成一份问题清单。
 *
 * @param {object} report  scanSkills() 的返回值（只读，不会被修改）
 * @param {object} [options]
 * @param {number} [options.minDescriptionLength] 覆盖「描述过短」阈值
 * @param {number} [options.emptyBodyBytes]       覆盖「正文疑似为空」阈值
 * @returns {{
 *   ok: true,
 *   checks: Array<{kind: string, skill: string, detail: string, filePath: string|null, source: string|null, form: string|null}>,
 *   summary: {total: number, shadowed: number, shortDescription: number, dirNameMismatch: number, emptyBody: number,
 *             byKind: Record<string, number>, scanned: number},
 *   thresholds: {minDescriptionLength: number, emptyBodyBytes: number},
 *   note: string
 * }}
 */
export function analyzeSkills(report, options) {
  const thresholds = {
    minDescriptionLength: normalizeThreshold(options?.minDescriptionLength, MIN_DESCRIPTION_LENGTH),
    emptyBodyBytes: normalizeThreshold(options?.emptyBodyBytes, EMPTY_BODY_BYTES),
  };

  try {
    const skills = Array.isArray(report?.skills) ? report.skills : [];
    /** @type {Map<string, Array<object>>} 固定分组，最后按 KIND_ORDER 展开 */
    const buckets = new Map(KIND_ORDER.map((kind) => [kind, []]));
    /** 去重键：同一技能（同一 filePath）的同一类问题只出现一次 */
    const seen = new Set();
    let scanned = 0;

    for (let index = 0; index < skills.length; index += 1) {
      const skill = skills[index];
      if (skill === null || typeof skill !== 'object' || Array.isArray(skill)) continue;
      scanned += 1;

      const name =
        typeof skill.name === 'string' && skill.name.trim() !== '' ? skill.name.trim() : '（未命名技能）';
      const filePath = typeof skill.filePath === 'string' ? skill.filePath : null;
      const source = typeof skill.source === 'string' ? skill.source : null;
      const form = typeof skill.form === 'string' ? skill.form : null;
      const identity = filePath ?? `${name}#${index}`;

      const push = (kind, detail) => {
        const key = `${kind}\u0000${identity}`;
        if (seen.has(key)) return;
        seen.add(key);
        buckets.get(kind).push({ kind, skill: name, detail, filePath, source, form });
      };

      // 1) 跨根重名被遮蔽：scan.js 已经算好 shadowed / shadowedBy，这里只负责讲清楚后果
      if (skill.shadowed === true) {
        const shadowedBy =
          typeof skill.shadowedBy === 'string' && skill.shadowedBy !== ''
            ? skill.shadowedBy
            : '另一个更低 rank 的同名技能';
        push(
          CHECK_KINDS.shadowed,
          `与同名技能重名，被更低 rank 的「${shadowedBy}」遮蔽；这一份永远不会被模型加载到`,
        );
      }

      const statusOk = skill.status === STATUS_OK;

      // 2) 描述为空或过短：模型只靠 description 判断要不要用，空描述等于没写
      if (statusOk) {
        const description = typeof skill.description === 'string' ? skill.description : '';
        const length = description.trim().length;
        if (length < thresholds.minDescriptionLength) {
          push(
            CHECK_KINDS.shortDescription,
            length === 0
              ? `描述为空（实际长度 0 字，阈值 ${thresholds.minDescriptionLength} 字）`
              : `描述只有 ${length} 字，少于阈值 ${thresholds.minDescriptionLength} 字`,
          );
        }
      }

      // 3) 目录名 ≠ frontmatter name：只对目录式技能成立，flat-md 的 entryPath 是根本身，无意义
      if (form === DIR_BUNDLE) {
        const dirName = dirNameOf(skill);
        const frontName = typeof skill.name === 'string' ? skill.name.trim() : '';
        if (dirName !== '' && frontName !== '' && dirName !== frontName) {
          push(
            CHECK_KINDS.dirNameMismatch,
            `目录名「${dirName}」与 frontmatter 里的 name「${frontName}」不一致`,
          );
        }
      }

      // 4) 正文疑似为空：按整文件字节数估计（含 frontmatter），所以只能说「疑似」
      if (statusOk) {
        const bytes =
          typeof skill.bytes === 'number' && Number.isFinite(skill.bytes) && skill.bytes >= 0
            ? skill.bytes
            : null;
        if (bytes !== null && bytes < thresholds.emptyBodyBytes) {
          push(
            CHECK_KINDS.emptyBody,
            `文件只有 ${bytes} 字节，少于 ${thresholds.emptyBodyBytes} 字节阈值（按文件字节估计，含 frontmatter，不是精确正文长度）`,
          );
        }
      }
    }

    const checks = [];
    const byKind = {};
    for (const kind of KIND_ORDER) {
      const bucket = buckets.get(kind);
      byKind[kind] = bucket.length;
      checks.push(...bucket);
    }

    const summary = {
      total: skills.length,
      shadowed: byKind[CHECK_KINDS.shadowed],
      shortDescription: byKind[CHECK_KINDS.shortDescription],
      dirNameMismatch: byKind[CHECK_KINDS.dirNameMismatch],
      emptyBody: byKind[CHECK_KINDS.emptyBody],
      byKind,
      scanned,
    };

    return { ok: true, checks, summary, thresholds, note: NOTE };
  } catch {
    // 诊断函数本身绝不抛：畸形输入就当作「没发现问题」
    return emptyResult(thresholds);
  }
}
