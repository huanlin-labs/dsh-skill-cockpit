/**
 * skill-cockpit · 自动加载（1.1.0）
 *
 * 目的：把「拨到全开的技能」在相关任务出现时自动送进本轮上下文，
 * 不要求用户改规则、不要求模型自觉调 skill_panel。
 *
 * 本文件是纯函数层（无 fs / 无网络 / 无 ctx），所以可以完整自测：
 *   tokenize()          文本 → 检索词（英文词 + 中文二元组）
 *   scoreSkill()        单个技能 vs 一句用户话 → 分数 + 命中词
 *   selectSkills()      全量技能 → 该注入哪几个（三档灵敏度 + 预算 + 排除）
 *   buildReminder()     选中的技能 → 一段 <system-reminder> 文本
 *   readMessageText()   从宿主消息对象里取出纯文本（字段名不可假定，见下）
 *   buildInjectedMessage()  以本轮真实用户消息为模板克隆出注入消息
 *
 * 关于消息形状：宿主 `agent/pre-step` 的 decision.messages 元素形状没有公开
 * 文档，且随版本可能变化。这里的策略是「以本轮真实消息为模板」：克隆一条
 * 已经通过宿主校验的消息，只替换它的文本载荷并换 id，因此结构永远合法。
 */

export const TIERS = Object.freeze({
  strict: { key: 'strict', label: '严格', maxSkillBytes: 4096, threshold: 4.0, minDescHits: 2 },
  standard: { key: 'standard', label: '标准', maxSkillBytes: 8192, threshold: 2.5, minDescHits: 1 },
  loose: { key: 'loose', label: '宽松', maxSkillBytes: 16384, threshold: 1.5, minDescHits: 1 },
});

/**
 * 中文说法 → 技能里惯用的英文词。
 * 实测痛点：office-* 这类技能的 description 是英文（Word / Excel / PowerPoint），
 * 用户说「表格」「幻灯片」时纯词面对不上，必须靠这张表搭桥。
 * 只做「领域词」映射，不做整句翻译——映射错了顶多漏召回，不会注入错技能。
 */
const SYNONYMS = Object.freeze({
  表格: 'excel spreadsheet',
  电子表格: 'excel',
  公式: 'formula',
  文档: 'document word',
  文字: 'document word',
  幻灯片: 'powerpoint slides pptx presentation',
  演示: 'presentation slides',
  图片: 'image',
  图像: 'image',
  截图: 'screenshot image',
  相机: 'camera',
  拍照: 'camera photo',
  报错: 'error',
  错误: 'error',
  异常: 'error exception',
  调试: 'debug',
  排查: 'debug diagnose',
  缺陷: 'bug defect',
  漏洞: 'vulnerability security',
  代码: 'code',
  审查: 'review',
  评审: 'review',
  提交: 'commit',
  分支: 'branch',
  合并: 'merge',
  测试: 'test testing',
  界面: 'ui interface',
  视觉: 'visual design',
  设计: 'design',
  排版: 'layout',
  小说: 'fiction novel',
  叙事: 'narrative fiction',
  文献: 'literature reference citation',
  论文: 'paper',
  引用: 'citation',
  翻译: 'translate translation',
  水印: 'watermark',
  页眉: 'header',
  拆分: 'split',
  加密: 'encrypt',
  表单: 'form',
  性能: 'performance',
  重构: 'refactor',
  并发: 'concurrency',
  书: 'book',
  拆书: 'book distill',
});

/** 把中文领域词替换成技能描述里常用的英文等价词（幂等，可对两侧文本同时用）。 */
export function normalizeText(text) {
  if (typeof text !== 'string' || text === '') return '';
  let out = text.toLowerCase();
  for (const [zh, en] of Object.entries(SYNONYMS)) {
    if (out.includes(zh)) out = out.split(zh).join(` ${en} `);
  }
  return out;
}

export const DEFAULT_BUDGET_BYTES = 24576;
export const SOURCE_KIND = 'skill-autoload';

const STOPWORDS = new Set([
  'the', 'and', 'for', 'you', 'your', 'with', 'this', 'that', 'from', 'have', 'has', 'are', 'was',
  'were', 'will', 'would', 'can', 'could', 'should', 'please', 'help', 'me', 'my', 'our', 'use',
  'using', 'used', 'how', 'what', 'when', 'where', 'which', 'who', 'why', 'not', 'but', 'all',
  'any', 'get', 'got', 'make', 'made', 'need', 'want', 'into', 'out', 'about', 'then', 'than',
  'there', 'here', 'they', 'them', 'its', 'it', 'is', 'be', 'to', 'of', 'in', 'on', 'at', 'as',
  'or', 'if', 'do', 'does', 'did', 'a', 'an', 'so', 'we', 'us', 'i',
  // 中文高频虚词（单字不成词，这里只是防噪声）
  '这个', '那个', '我们', '你们', '他们', '一下', '一个', '可以', '怎么', '什么', '帮我', '请帮',
]);

/** 文本 → 检索词集合。英文按词（>2 字符、去停用词），中文按二元组。 */
export function tokenize(text) {
  const out = new Set();
  if (typeof text !== 'string' || text === '') return out;
  const lower = normalizeText(text);
  for (const m of lower.matchAll(/[a-z][a-z0-9+#.\-]+/g)) {
    const w = m[0].replace(/[.\-]+$/, '');
    if (w.length < 2 || STOPWORDS.has(w)) continue;
    out.add(w);
    // 极简复数归一：documents → document（只处理长词，避免 class → clas）
    if (w.length > 4 && w.endsWith('s') && !w.endsWith('ss')) out.add(w.slice(0, -1));
    // 连字符词再拆一份：async-await → async / await
    if (w.includes('-')) {
      for (const part of w.split('-')) {
        if (part.length >= 2 && !STOPWORDS.has(part)) out.add(part);
      }
    }
  }
  // 中文：按非汉字切段，每段取 2 字滑窗（够用的召回，避免上分词依赖）
  for (const seg of lower.matchAll(/[\u4e00-\u9fff]+/g)) {
    const s = seg[0];
    if (s.length === 1) {
      out.add(s);
      continue;
    }
    for (let i = 0; i + 2 <= s.length; i += 1) {
      const bi = s.slice(i, i + 2);
      if (!STOPWORDS.has(bi)) out.add(bi);
    }
  }
  return out;
}

/** 技能名拆词：ui-design → ui, design；OfficeDocx → office, docx（小写后按 - _ 空格切） */
function nameTokens(name) {
  const out = new Set();
  if (typeof name !== 'string') return out;
  for (const part of name.toLowerCase().split(/[^a-z0-9]+/)) {
    if (part.length >= 2 && !STOPWORDS.has(part)) out.add(part);
  }
  return out;
}

/**
 * 单个技能对一句用户话的匹配打分。
 * @returns {{score:number, nameHits:string[], descHits:string[]}}
 */
export function scoreSkill(skill, queryTokens, idf = null) {
  const weight = (t) => (idf && idf.has(t) ? idf.get(t) : 2);
  const nHits = [];
  const dHits = [];
  const nTok = nameTokens(skill?.name);
  for (const t of nTok) if (queryTokens.has(t)) nHits.push(t);
  const descTok = tokenize(`${skill?.description ?? ''} ${skill?.whenToUse ?? ''}`);
  for (const t of descTok) if (queryTokens.has(t)) dHits.push(t);

  // IDF 加权：只在本机某一个技能里出现的词（如「小说」「公式」）权重最高，
  // 满大街都有的词（如「文件」）权重低——比单纯数命中词更能区分。
  const top = (list, n) => list.map(weight).sort((a, b) => b - a).slice(0, n).reduce((a, b) => a + b, 0);
  let score = top(nHits, 2) * 2 + top(dHits, 4);
  // 技能名整串原样出现在用户话里，直接重加权
  const q = skill?.__query ?? '';
  if (typeof skill?.name === 'string' && q.includes(skill.name.toLowerCase())) score += 4;
  return { score, nameHits: nHits, descHits: dHits };
}

/** 语料级 IDF：df = 有多少个技能的「名字+简介」包含该词。
 *  n 取 max(20, 技能数)：只装了三五个技能时，若按真实语料算，df 接近 n，
 *  IDF 会被压到接近 0，结果「词明明对上了却一条都不触发」。拿 20 当分母下限，
 *  小技能库也能正常命中；技能多了以后仍按真实 df 区分常见词与稀有词。
 */
function buildIdf(skills) {
  const n = Math.max(20, skills.length);
  const df = new Map();
  for (const s of skills) {
    if (!s || typeof s.name !== 'string') continue;
    const toks = new Set([
      ...nameTokens(s.name),
      ...tokenize(`${s.description ?? ''} ${s.whenToUse ?? ''}`),
    ]);
    for (const t of toks) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const idf = new Map();
  for (const [t, c] of df) idf.set(t, Math.max(1.0, Math.log((n + 1) / (c + 0.5))));
  return idf;
}

/** 设置归一化：坏值一律回落到默认，不抛。 */
export function normalizeSettings(raw) {
  const base = raw && typeof raw === 'object' ? raw : {};
  const tier = Object.hasOwn(TIERS, base.tier) ? base.tier : 'standard';
  const budget =
    Number.isInteger(base.budgetBytes) && base.budgetBytes > 0 ? base.budgetBytes : DEFAULT_BUDGET_BYTES;
  return {
    enabled: base.enabled === true,
    tier,
    budgetBytes: budget,
    perSkillOff: Array.isArray(base.perSkillOff)
      ? base.perSkillOff.filter((n) => typeof n === 'string' && n !== '')
      : [],
    probe: base.probe === true,
    // 本场必用：不看分数直接注入（1.2.0）
    pinned: Array.isArray(base.pinned) ? base.pinned.filter((n) => typeof n === 'string' && n !== '') : [],
  };
}

/**
 * 选出本轮该注入的技能。
 * @param {object} arg
 * @param {Array<{name:string,description?:string,body?:string,enabled?:boolean}>} arg.skills
 * @param {string} arg.query       本轮用户原话
 * @param {string} arg.tier        strict | standard | loose
 * @param {number} [arg.budgetBytes]
 * @param {string[]} [arg.perSkillOff]
 * @param {string[]} [arg.alreadyInjected] 本会话已注入过的技能名（去重）
 * @param {number} [arg.maxSkills] 单轮最多注入几个（默认 3）
 */
export function selectSkills({
  skills = [],
  query = '',
  tier = 'standard',
  budgetBytes = DEFAULT_BUDGET_BYTES,
  perSkillOff = [],
  alreadyInjected = [],
  pinned = [],
  maxSkills = 3,
} = {}) {
  const t = TIERS[tier] ?? TIERS.standard;
  const qTokens = tokenize(query);
  const pinnedSet = new Set(pinned);
  if (qTokens.size === 0 && pinnedSet.size === 0) return { picked: [], budgetUsed: 0, tier: t.key, considered: 0 };

  const off = new Set(perSkillOff);
  const seen = new Set(alreadyInjected);
  const idf = buildIdf(skills);
  const scored = [];
  for (const skill of skills) {
    if (!skill || typeof skill.name !== 'string' || skill.name === '') continue;
    if (skill.enabled === false) continue;
    if (off.has(skill.name) || seen.has(skill.name)) continue;
    const probe = { ...skill, __query: normalizeText(query) };
    const { score, nameHits, descHits } = scoreSkill(probe, qTokens, idf);
    if (score < t.threshold) continue;
    if (descHits.length < t.minDescHits) continue;
    scored.push({ skill, score, nameHits, descHits });
  }
  scored.sort((a, b) => b.score - a.score || String(a.skill.name).localeCompare(String(b.skill.name)));

  const picked = [];
  let used = 0;
  const pickedNames = new Set();
  // 本场必用（pin）：不看相关度，排在所有自动选择之前，但同样受单技能与总预算约束
  for (const skill of skills) {
    if (!skill || typeof skill.name !== 'string' || skill.name === '') continue;
    if (!pinnedSet.has(skill.name) || skill.enabled === false || seen.has(skill.name)) continue;
    const body = typeof skill.body === 'string' ? skill.body : '';
    const bodyBytes = Buffer.byteLength(body, 'utf8');
    const cap = Math.min(t.maxSkillBytes, bodyBytes > 0 ? bodyBytes : t.maxSkillBytes);
    if (used + cap > budgetBytes) continue;
    used += cap;
    picked.push({
      name: skill.name,
      description: typeof skill.description === 'string' ? skill.description : '',
      body: truncateUtf8(body, cap),
      score: Number.POSITIVE_INFINITY,
      hits: ['pinned'],
      pinned: true,
    });
    pickedNames.add(skill.name);
  }
  for (const row of scored) {
    if (picked.length >= Math.max(maxSkills, pinnedSet.size)) break;
    if (pickedNames.has(row.skill.name)) continue;
    const body = typeof row.skill.body === 'string' ? row.skill.body : '';
    // 注意按【字节】算：truncateUtf8 的第二个参数是字节数，用 body.length（UTF-16 码元）会把中文正文截空
    const bodyBytes = Buffer.byteLength(body, 'utf8');
    const cap = Math.min(t.maxSkillBytes, bodyBytes > 0 ? bodyBytes : t.maxSkillBytes);
    if (used + cap > budgetBytes) continue;
    used += cap;
    picked.push({
      name: row.skill.name,
      description: typeof row.skill.description === 'string' ? row.skill.description : '',
      body: truncateUtf8(body, cap),
      score: row.score,
      hits: [...row.nameHits, ...row.descHits],
    });
  }
  return { picked, budgetUsed: used, tier: t.key, considered: skills.length };
}

/** 按字节截断（不切断多字节字符），超限时附省略标记。 */
export function truncateUtf8(text, maxBytes) {
  if (typeof text !== 'string' || maxBytes <= 0) return '';
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return text;
  const suffix = '\n\n…（已截断，完整内容见技能原文）';
  const room = Math.max(0, maxBytes - Buffer.byteLength(suffix, 'utf8'));
  let slice = buf.subarray(0, room).toString('utf8');
  // subarray 可能切在多字节中间，toString 会产成替换符：砍掉尾部坏字符
  slice = slice.replace(/\uFFFD+$/, '');
  return slice + suffix;
}

/** 提醒文本里出现 </system-reminder> 会把宿主框架提前闭合，必须转义。 */
export function escapeReminder(text) {
  return String(text).replaceAll('</system-reminder>', '&lt;/system-reminder&gt;');
}

export function buildReminder(picked, { reason = '' } = {}) {
  if (!Array.isArray(picked) || picked.length === 0) return '';
  const parts = [];
  parts.push('<system-reminder>');
  parts.push('以下技能与本轮任务相关，已自动加载到上下文（skill-cockpit 自动加载）。');
  parts.push('请直接按这些技能正文办事，不要再问要不要用、也不必再调用 skill_panel 去读它们。');
  if (reason) parts.push(escapeReminder(reason));
  for (const item of picked) {
    parts.push('');
    parts.push(`### 技能：${escapeReminder(item.name)}`);
    if (item.description) parts.push(`> ${escapeReminder(item.description.replace(/\s+/g, ' ').trim())}`);
    parts.push('');
    parts.push(
      item.body && item.body.trim() !== ''
        ? escapeReminder(item.body)
        : '（该技能正文为空，仅按名字/简介参考）',
    );
  }
  // 框架标签由我们自己加、且只加一次：正文里的同名标签已在上面转义
  parts.push('</system-reminder>');
  return parts.join('\n');
}

/**
 * 从宿主消息对象里取纯文本。字段名未知，按已知形态逐个试。
 * 取不到返回 ''（调用方据此跳过本轮，不猜）。
 */
export function readMessageText(msg) {
  if (msg == null) return '';
  if (typeof msg === 'string') return msg;
  const cand = [
    msg.text,
    msg.content,
    msg.message,
    msg.context?.text,
    msg.context?.content,
    msg.source?.text,
  ];
  for (const c of cand) {
    if (typeof c === 'string' && c.trim() !== '') return c;
    if (Array.isArray(c)) {
      const joined = c
        .map((p) => (typeof p === 'string' ? p : typeof p?.text === 'string' ? p.text : ''))
        .filter(Boolean)
        .join('\n');
      if (joined.trim() !== '') return joined;
    }
    if (c && typeof c === 'object' && typeof c.text === 'string' && c.text.trim() !== '') return c.text;
  }
  return '';
}

/** 是不是「用户说的话」——用户消息优先按 role，其次按有没有 role（没有就当用户）。 */
export function isUserMessage(msg) {
  const role = msg?.role ?? msg?.message?.role;
  if (typeof role === 'string' && role !== '') return role === 'user';
  return true;
}

/** 找到本轮最后一条用户消息的下标（跳过我们自己注入的）。 */
export function findLastUserIndex(messages) {
  if (!Array.isArray(messages)) return -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?.source?.kind === SOURCE_KIND) continue;
    if (!isUserMessage(m)) continue;
    if (readMessageText(m).trim() === '') continue;
    return i;
  }
  return -1;
}

function deepClone(value) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      /* 含不可克隆值（函数等）时退回 JSON */
    }
  }
  return JSON.parse(JSON.stringify(value));
}

/** 把一条消息的文本载荷换掉（就地改克隆体，尽量不动别的字段）。 */
function replaceMessageText(msg, text) {
  if (typeof msg.text === 'string') {
    msg.text = text;
    return true;
  }
  if (typeof msg.content === 'string') {
    msg.content = text;
    return true;
  }
  if (Array.isArray(msg.content)) {
    const textPart = msg.content.find((p) => typeof p === 'string' || typeof p?.text === 'string');
    if (textPart !== undefined) {
      if (typeof textPart === 'string') {
        msg.content = msg.content.map((p) => (p === textPart ? text : p));
      } else {
        textPart.text = text;
        msg.content = msg.content.filter((p) => p === textPart || p?.type !== 'text');
      }
      return true;
    }
  }
  if (typeof msg.message === 'string') {
    msg.message = text;
    return true;
  }
  if (msg.message && typeof msg.message === 'object' && typeof msg.message.content === 'string') {
    msg.message.content = text;
    return true;
  }
  if (msg.context && typeof msg.context === 'object' && typeof msg.context.text === 'string') {
    msg.context.text = text;
    return true;
  }
  return false;
}

/**
 * 造一条注入消息：克隆模板（= 本轮真实用户消息），换文本、换 id、打 source 标记。
 * 模板不可用时回落到最小形态（仍然给了 source，宿主可按 kind 识别）。
 */
export function buildInjectedMessage(template, text, { id } = {}) {
  const fallback = { id: id ?? 'skill-autoload', role: 'user', content: text, source: { kind: SOURCE_KIND } };
  if (!template || typeof template !== 'object') return fallback;
  let clone;
  try {
    clone = deepClone(template);
  } catch {
    return fallback;
  }
  if (!replaceMessageText(clone, text)) return fallback;
  if ('id' in clone) clone.id = id ?? `skill-autoload-${Math.random().toString(36).slice(2, 10)}`;
  if (clone.source && typeof clone.source === 'object') clone.source = { kind: SOURCE_KIND };
  else clone.source = { kind: SOURCE_KIND };
  if (typeof clone.role !== 'string' && typeof clone.message?.role !== 'string') clone.role = 'user';
  return clone;
}

/** 把注入消息插到「本轮用户消息」之后；找不到用户消息就追加到末尾。 */
export function insertInjected(messages, injected) {
  const list = Array.isArray(messages) ? messages.slice() : [];
  const at = findLastUserIndex(list);
  const pos = at < 0 ? list.length : at + 1;
  list.splice(pos, 0, injected);
  return list;
}
