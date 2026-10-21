/**
 * dsh-skill-panel · 管理功能（纯函数）
 *
 * 这里只做「算出要写什么」，**不碰磁盘**。
 * 真正落盘要走 index.js 的路由 + 户主批准（红线：新增写盘动作要单独批）。
 *
 * 名字校验特别重要 —— 见调研里 michengai 踩过的坑：
 * 中文名 / 混合名被各家用不同的「合法化」规则截断，结果变成一串看不懂的
 * 拼音或下划线，用户回头找不到自己的技能。所以这里**不擅自改造名字**：
 * 不合法就直说为什么不合法，让用户自己决定改成什么。
 */

/** 技能名：小写字母开头，允许小写字母/数字/连字符，2–64 字。 */
const NAME_RE = /^[a-z][a-z0-9-]{1,63}$/;

/**
 * @returns {{ok:true,value:string}|{ok:false,error:string}}
 */
export function validateSkillName(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value === '') return { ok: false, error: '名字不能为空' };
  if (/[\u4e00-\u9fa5]/.test(value)) {
    return {
      ok: false,
      error:
        '名字里有中文。技能名要能被当成目录名和调用名，只能用 a-z、0-9、-（例如 writing-helper），介绍里再写中文。',
    };
  }
  if (!NAME_RE.test(value)) {
    return {
      ok: false,
      error: '名字只能用小写字母开头，后接小写字母、数字、连字符，长度 2–64（例如 code-review）。',
    };
  }
  if (value.endsWith('-')) return { ok: false, error: '名字不能以连字符结尾。' };
  return { ok: true, value };
}

/** 简介一行内说完；太长会被列表截断，等于没写。 */
export function validateDescription(raw) {
  const value = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (value === '') return { ok: false, error: '简介不能为空 —— 它是模型判断"该不该用这个技能"的唯一依据。' };
  if (value.length < 8) return { ok: false, error: '简介太短了，至少写清楚"做什么 + 什么时候用"。' };
  if (value.length > 200) return { ok: false, error: `简介 ${value.length} 字，超过 200 —— 常驻上下文，越短越好。` };
  return { ok: true, value };
}

/** 正文：空正文的技能装了也没用（体检里那条 empty-body 说的就是它）。 */
export function validateBody(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value === '') return { ok: false, error: '正文不能为空。' };
  return { ok: true, value };
}

/** 保险：frontmatter 里的值里出现换行会把 YAML 结构撑破。 */
function oneLine(text) {
  return String(text).replace(/[\r\n]+/g, ' ').trim();
}

/**
 * 生成一份 SKILL.md 的完整文本。
 *
 * 只生成**最小可用**的 frontmatter：name + description。
 * 不预置 disable-model-invocation 之类的开关 —— 新技能默认全开，
 * 用户想改状态用面板上的四态胶囊，不必在模板里埋坑。
 *
 * @returns {{text:string}|{error:string}}
 */
export function buildSkillFile(input = {}) {
  const name = validateSkillName(input.name);
  if (!name.ok) return { error: name.error };
  const description = validateDescription(input.description);
  if (!description.ok) return { error: description.error };
  const body = validateBody(input.body);
  if (!body.ok) return { error: body.error };

  const lines = ['---', `name: ${name.value}`, `description: ${oneLine(description.value)}`];
  const when = typeof input.whenToUse === 'string' ? oneLine(input.whenToUse) : '';
  if (when !== '') lines.push(`when-to-use: ${when}`);
  lines.push('---', '', body.value, '');

  return { text: lines.join('\n') };
}
