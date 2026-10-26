/**
 * 自动加载的离线评测（1.2.0 · 对应「V2 之后：全开 = 高置信触发」的验收口径）
 *
 * 口径来自 `调研/2026-10-21_技能开而不读-根因调研.md` §九：
 *   命中类 recall ≥ 80%（目标 90%），误注入 ≤ 1/10。
 * 20 条查询集内置在这里，改描述 / 改引擎后直接重跑对比。
 *
 * 纯函数：不读盘、不写盘，skills 由调用方扫描后传入。
 */
import { DEFAULT_BUDGET_BYTES, selectSkills } from './autoload.js';

export const DEFAULT_CASES = [
  { q: '这段代码报错了，帮我看看哪里出了问题', expect: 'debugging' },
  { q: '帮我给这个函数补一套单元测试', expect: 'testing' },
  { q: '审查一下这个 PR 的代码质量', expect: 'code-review' },
  { q: '把这次改动按规范提交，写清楚 commit message', expect: 'git-workflow' },
  { q: '把这个 Excel 表格里的公式重算一下', expect: 'xlsx' },
  { q: '帮我生成一份 Word 文档，带目录和页眉', expect: 'docx' },
  { q: '做一套十二页的 PPT，讲季度汇报', expect: 'pptx' },
  { q: '把这份 PDF 里的表格提取出来', expect: 'pdf' },
  { q: '总结一下这个 B 站视频讲了什么', expect: 'video-understand' },
  { q: '给这个页面设计一下配色和排版', expect: 'ui-design' },
  { q: '今天天气怎么样', expect: null },
  { q: '帮我写一首五言绝句', expect: null },
  { q: '一加一等于几', expect: null },
  { q: '推荐几部好看的科幻电影', expect: null },
  { q: '把这句话翻译成法语', expect: null },
  { q: '明天早上七点提醒我开会', expect: null },
  { q: '算一下一百二十八乘以三十七是多少', expect: null },
  { q: '讲个笑话吧', expect: null },
  { q: '我有点累，随便聊聊', expect: null },
  { q: '这本书值得读吗', expect: null },
];

/**
 * @returns {{cases:Array, hit:{total:number,passed:number,recall:number|null},
 *            miss:{total:number,fired:number,falseRate:number|null},
 *            missing:Array<string>, missingExpect:boolean}}
 */
export function runEval({ skills = [], settings = {}, cases = DEFAULT_CASES } = {}) {
  const names = new Set(skills.map((s) => s?.name).filter(Boolean));
  const rows = [];
  let hitTotal = 0;
  let hitPassed = 0;
  let missTotal = 0;
  let missFired = 0;
  const missing = [];

  for (const c of cases) {
    const { picked } = selectSkills({
      skills,
      query: c.q,
      tier: settings.tier ?? 'standard',
      budgetBytes: settings.budgetBytes ?? DEFAULT_BUDGET_BYTES,
      perSkillOff: [],
      alreadyInjected: [],
      maxSkills: 3,
    });
    const got = picked.map((p) => p.name);
    if (c.expect == null) {
      missTotal += 1;
      if (got.length > 0) missFired += 1;
      rows.push({ q: c.q, kind: 'miss', expect: null, got, ok: got.length === 0 });
      continue;
    }
    if (!names.has(c.expect)) {
      // 期望的技能本机没装：标 missing，不计入分母（否则数字没有意义）
      if (!missing.includes(c.expect)) missing.push(c.expect);
      rows.push({ q: c.q, kind: 'hit', expect: c.expect, got, ok: null, missing: true });
      continue;
    }
    hitTotal += 1;
    const ok = got.includes(c.expect);
    if (ok) hitPassed += 1;
    rows.push({ q: c.q, kind: 'hit', expect: c.expect, got, ok });
  }

  return {
    cases: rows,
    hit: {
      total: hitTotal,
      passed: hitPassed,
      recall: hitTotal === 0 ? null : Math.round((hitPassed / hitTotal) * 1000) / 1000,
    },
    miss: {
      total: missTotal,
      fired: missFired,
      falseRate: missTotal === 0 ? null : Math.round((missFired / missTotal) * 1000) / 1000,
    },
    missing,
    missingExpect: hitTotal === 0,
  };
}
