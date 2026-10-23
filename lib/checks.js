/**
 * dsh-skill-panel · 诊断层（纯函数，绝不读磁盘）。
 *
 * 输入是 GET /__dsh-skill-panel/skills 返回的扫描报告（见 lib/scan.js），
 * 输出六类问题，供 GET /__dsh-skill-panel/checks 使用：
 *
 *   0 root-missing       配置的技能根不存在 —— 该根下的技能一条都不会加载
 *   1 invalid-entry      入口文件被判无效（dropped:* / 读失败），运行时静默丢弃
 *   2 shadowed           跨根重名，rank 更高的那份遮蔽了这份，模型永远看不到
 *   3 short-description  描述为空或过短（模型靠描述决定要不要用这个技能）
 *   4 dir-name-mismatch  目录名 ≠ frontmatter 里的 name（人肉找技能时极易找错）
 *   5 empty-body         文件字节数极小，正文疑似为空（只剩 frontmatter）
 *
 * 前两类回答的是「为什么某技能根本看不见」，后四类回答的是「看得见但白占坑」。
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

/** 六类问题的机器名（给人看的中文文案见 CHECK_LABELS） */
export const CHECK_KINDS = {
  rootMissing: 'root-missing',
  invalidEntry: 'invalid-entry',
  shadowed: 'shadowed',
  shortDescription: 'short-description',
  dirNameMismatch: 'dir-name-mismatch',
  emptyBody: 'empty-body',
};

/** 六类问题的中文标签 */
export const CHECK_LABELS = {
  [CHECK_KINDS.rootMissing]: '技能根不存在',
  [CHECK_KINDS.invalidEntry]: '入口文件被判无效',
  [CHECK_KINDS.shadowed]: '跨根重名被遮蔽',
  [CHECK_KINDS.shortDescription]: '描述为空或过短',
  [CHECK_KINDS.dirNameMismatch]: '目录名≠技能名',
  [CHECK_KINDS.emptyBody]: '正文疑似为空',
};

/**
 * 每类问题的「解法库」—— 只描述选项与后果，**本文件绝不执行任何一条**。
 *
 * `writes: true` 表示该解法会改动用户的技能文件（改名 / 改内容 / 删除），
 * 属于插件红线之外的动作：面板只能展示它、说明后果，实现时必须先经户主单独批准。
 * `writes: false` 的解法只改插件自己的扫描配置或什么都不做。
 */
export const FIX_LIBRARY = {
  [CHECK_KINDS.rootMissing]: [
    {
      id: 'create-root-dir',
      label: '按这个路径把目录建出来',
      effect: '以后放进去的技能才会被扫到；目录本身不影响现有技能',
      writes: true,
    },
    {
      id: 'drop-root',
      label: '把这条根从配置里去掉',
      effect: '体检不再报它；它下面本来也没有技能被加载',
      writes: false,
    },
    {
      id: 'ignore',
      label: '先不管',
      effect: '技能照旧；只是一直会有一条「根不存在」的提示',
      writes: false,
    },
  ],
  [CHECK_KINDS.invalidEntry]: [
    {
      id: 'fix-frontmatter',
      label: '按报错把入口文件修好',
      effect: '修好后重新扫描，这个技能模型才看得到',
      writes: true,
    },
    {
      id: 'rename-disabled',
      label: '确认废弃就改成 .disabled 收起来',
      effect: '不再被当成坏文件；面板上显示为「已停用」',
      writes: true,
    },
    {
      id: 'ignore',
      label: '先不管',
      effect: '运行时每次扫描都会静默丢弃它',
      writes: false,
    },
  ],
  [CHECK_KINDS.shadowed]: [
    {
      id: 'rename-this',
      label: '给这一份换个不同的名字',
      effect: '两份名字不再相同，模型两份都能看到',
      writes: true,
    },
    {
      id: 'drop-this',
      label: '删掉这一份',
      effect: '只保留 rank 更高的那一份；删了不会自动回来',
      writes: true,
    },
    {
      id: 'narrow-roots',
      label: '让这个根不再被扫描',
      effect: '该根下所有技能都会消失，影响面最大',
      writes: false,
    },
  ],
  [CHECK_KINDS.shortDescription]: [
    {
      id: 'edit-description',
      label: '把描述补到 20 字以上',
      effect: '模型能判断该不该用这个技能（空描述等于没写）',
      writes: true,
    },
    {
      id: 'ignore',
      label: '先不管',
      effect: '技能照常加载，只是模型很难主动选它',
      writes: false,
    },
  ],
  [CHECK_KINDS.dirNameMismatch]: [
    {
      id: 'rename-dir',
      label: '把目录名改成与 name 一致',
      effect: '人和模型看到的名字统一；目录改名后路径会变',
      writes: true,
    },
    {
      id: 'edit-name',
      label: '把 frontmatter 的 name 改成与目录一致',
      effect: '不动目录结构；该技能的调用名会变',
      writes: true,
    },
    {
      id: 'ignore',
      label: '先不管',
      effect: '加载不受影响，只是人肉找技能时容易找错',
      writes: false,
    },
  ],
  [CHECK_KINDS.emptyBody]: [
    {
      id: 'write-body',
      label: '补上正文',
      effect: '技能真正能被用上；只有 frontmatter 的技能等于空壳',
      writes: true,
    },
    {
      id: 'ignore',
      label: '先不管',
      effect: '仍然加载，但调用时没有内容可依',
      writes: false,
    },
  ],
};

/** 单条问题附带解法（按 kind 取，未知 kind 给空数组，绝不抛） */
function fixesFor(kind) {
  const list = FIX_LIBRARY[kind];
  return Array.isArray(list) ? list : [];
}

/** checks 的固定分组顺序：先答「为什么看不见」，再看「看得见但白占坑」 */
const KIND_ORDER = [
  CHECK_KINDS.rootMissing,
  CHECK_KINDS.invalidEntry,
  CHECK_KINDS.shadowed,
  CHECK_KINDS.shortDescription,
  CHECK_KINDS.dirNameMismatch,
  CHECK_KINDS.emptyBody,
];

/** 入口文件被判无效时，把机器状态码翻成人话（scan.js 的 STATUS 常量见 lib/frontmatter.js） */
const STATUS_DETAIL = {
  'dropped:no-frontmatter': '文件开头没有 --- frontmatter 块，运行时静默丢弃，模型看不到',
  'dropped:unclosed': 'frontmatter 的 --- 没有闭合，运行时静默丢弃，模型看不到',
  'dropped:bad-yaml': 'frontmatter 的 YAML 解析失败，运行时静默丢弃，模型看不到',
  'dropped:missing-fields': 'frontmatter 缺 name 或 description，运行时静默丢弃，模型看不到',
  'dropped:bad-name': 'name 不是合法技能名（只允许 a-z 0-9 -），运行时静默丢弃，模型看不到',
  error: '入口文件读不出来（权限或编码问题），模型看不到',
};

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
      rootMissing: 0,
      invalidEntry: 0,
      shadowed: 0,
      shortDescription: 0,
      dirNameMismatch: 0,
      emptyBody: 0,
      byKind: {
        [CHECK_KINDS.rootMissing]: 0,
        [CHECK_KINDS.invalidEntry]: 0,
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
    const roots = Array.isArray(report?.roots) ? report.roots : [];
    /** @type {Map<string, Array<object>>} 固定分组，最后按 KIND_ORDER 展开 */
    const buckets = new Map(KIND_ORDER.map((kind) => [kind, []]));
    /** 去重键：同一对象（同一 filePath / 同一根路径）的同一类问题只出现一次 */
    const seen = new Set();
    let scanned = 0;

    const add = (kind, identity, row) => {
      const key = `${kind}\u0000${identity}`;
      if (seen.has(key)) return;
      seen.add(key);
      const bucket = buckets.get(kind);
      if (!bucket) return;
      bucket.push({ kind, fixes: fixesFor(kind), evidence: null, ...row });
    };

    // 0) 技能根不存在：该根下一条技能也加载不到 —— 这是「看不到」最常见的原因
    for (let index = 0; index < roots.length; index += 1) {
      const root = roots[index];
      if (root === null || typeof root !== 'object' || Array.isArray(root)) continue;
      if (root.configured === false || root.exists === true) continue;
      const rootPath = typeof root.path === 'string' && root.path !== '' ? root.path : null;
      if (rootPath === null) continue;
      const source = typeof root.source === 'string' ? root.source : null;
      add(CHECK_KINDS.rootMissing, `root#${rootPath}`, {
        skill: lastSegment(rootPath) || rootPath,
        detail: `技能根不存在或读不到：${rootPath}${source ? `（来源 ${source}）` : ''}；这个根下的技能全都不会出现在模型目录里`,
        filePath: rootPath,
        source,
        form: null,
        evidence: { source, path: rootPath, rank: typeof root.rank === 'number' ? root.rank : null },
      });
    }

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

      const push = (kind, detail, evidence) =>
        add(kind, identity, { skill: name, detail, filePath, source, form, evidence: evidence ?? null });

      // 1) 跨根重名被遮蔽：scan.js 已经算好 shadowed / shadowedBy，这里只负责讲清楚后果
      if (skill.shadowed === true) {
        const shadowedBy =
          typeof skill.shadowedBy === 'string' && skill.shadowedBy !== ''
            ? skill.shadowedBy
            : '另一个更低 rank 的同名技能';
        push(
          CHECK_KINDS.shadowed,
          `与同名技能重名，被更低 rank 的「${shadowedBy}」遮蔽；这一份永远不会被模型加载到`,
          { shadowedBy },
        );
      }

      const statusOk = skill.status === STATUS_OK;
      const status = typeof skill.status === 'string' ? skill.status : '';

      // 1) 入口文件被判无效（dropped:* / 读失败）：运行时静默丢弃，模型永远看不到。
      //    这类技能在列表里也只是一行灰字，所以在体检里必须点名，否则用户以为「它就是不存在」。
      if (status !== '' && status !== STATUS_OK) {
        const base = STATUS_DETAIL[status] ?? `入口文件状态异常（${status}）`;
        const reason =
          typeof skill.reason === 'string' && skill.reason !== '' ? `（${skill.reason}）` : '';
        push(CHECK_KINDS.invalidEntry, `${base}${reason}`, {
          status,
          reason: typeof skill.reason === 'string' ? skill.reason : null,
        });
      }

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
      rootMissing: byKind[CHECK_KINDS.rootMissing],
      invalidEntry: byKind[CHECK_KINDS.invalidEntry],
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
