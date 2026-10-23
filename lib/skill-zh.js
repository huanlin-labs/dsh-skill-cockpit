// 技能说明的中文显示层。
//
// 技能说明的**真身**永远是它自己 SKILL.md 里的 description —— 这里不复制它，只在
// “那条说明是英文”时补一条中文给人看。两层来源，先用户后内置：
//   1. <dshHome>/dsh-skill-cockpit/skill-zh.json   形如 { "skillName": "中文说明" }
//   2. 下面这张随包发的小表（只覆盖本体自带、且原文是英文的几条）
// 取不到中文就原样显示英文 —— 宁可露出原文，也不杜撰。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const BUILTIN_SKILL_ZH = {
  deeptutor:
    '把 DeepTutor 个人知识库（RAG）与权威网页资料合起来，生成学习内容、自测题与学习计划，并把笔记存进笔记本。要学/复习某个技术主题（.NET、C#、SQL Server、React 等）、要深讲、要出练习题或做学习计划时用。',
  'html-doc':
    '把 Markdown（学习笔记、文档、题库）转成自包含的本地 HTML 页面，自带深/浅色切换、可折叠答案与打印友好排版。想要可离线阅读、可分享的网页成品时用。',
};

const cache = new Map();

/** 读 <dshHome>/dsh-skill-cockpit/skill-zh.json；坏文件当空，绝不让面板因此打不开。 */
function readUserMap(dshHome) {
  if (!dshHome) return {};
  const file = join(dshHome, 'dsh-skill-cockpit', 'skill-zh.json');
  const hit = cache.get(file);
  if (hit) return hit;
  let map = {};
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string' && value.trim()) map[key] = value.trim();
      }
    }
  } catch {
    map = {};
  }
  cache.set(file, map);
  return map;
}

/** 该 dshHome 下的 名字→中文 对照表（用户覆盖内置）。 */
export function skillZhMap(dshHome) {
  return { ...BUILTIN_SKILL_ZH, ...readUserMap(dshHome) };
}

/** 有中文就用中文，没有就原样返回英文说明。 */
export function localizeDescription(zh, name, description) {
  if (description && /[\u4e00-\u9fff]/.test(description)) return description;
  const hit = zh?.[name];
  return typeof hit === 'string' && hit ? hit : description ?? '';
}
