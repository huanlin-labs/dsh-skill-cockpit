/**
 * dsh-skill-panel · "not installed" index (second hop).
 *
 * MVP contract: a hit on this index is INFORMATION ONLY. The panel shows the
 * fields the index already carries and offers a copy button — it never
 * downloads, never installs, never writes. Anything more has to go through the
 * house registration + backup discipline, which is not this plugin's business.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';

export const DEFAULT_UNDECLARED_INDEX =
  'D:\\管家\\技能索引与最小路由\\技能改造\\未安装技能索引-正文.md';

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell.replace(/\s/g, '')));
}

function splitRow(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

/**
 * Parse markdown tables into {header, rows:[{cells,line}]} plus loose lines.
 * @returns {{tables: Array<object>, lines: Array<{text:string, line:number}>}}
 */
export function parseIndex(text) {
  const rawLines = text.split(/\r?\n/);
  const tables = [];
  const loose = [];
  let current = null;
  for (let i = 0; i < rawLines.length; i += 1) {
    const line = rawLines[i];
    const isTableLine = line.trim().startsWith('|');
    if (isTableLine) {
      const cells = splitRow(line);
      if (current === null) {
        current = { header: cells, rows: [], line: i + 1 };
        continue;
      }
      if (current.header !== null && current.rows.length === 0 && isSeparatorRow(cells)) {
        continue;
      }
      current.rows.push({ cells, line: i + 1 });
      continue;
    }
    if (current !== null) {
      tables.push(current);
      current = null;
    }
    if (line.trim() !== '') loose.push({ text: line, line: i + 1 });
  }
  if (current !== null) tables.push(current);
  return { tables, lines: loose };
}

export function indexStatus(indexPath) {
  if (typeof indexPath !== 'string' || indexPath === '') {
    return { configured: false, exists: false, path: null, note: '未配置未安装技能索引路径' };
  }
  if (!existsSync(indexPath)) {
    return { configured: true, exists: false, path: indexPath, note: '索引文件不存在（面板不报错，只是没有第二跳）' };
  }
  const info = statSync(indexPath);
  return { configured: true, exists: true, path: indexPath, bytes: info.size, mtimeMs: info.mtimeMs };
}

/**
 * @param {string} indexPath
 * @param {string} query
 * @param {number} limit
 */
export function searchUndeclared(indexPath, query, limit = 12) {
  const status = indexStatus(indexPath);
  const q = typeof query === 'string' ? query.trim().toLowerCase() : '';
  if (!status.exists) return { ...status, query: q, hits: [], total: 0 };
  if (q === '') return { ...status, query: q, hits: [], total: 0, note: '输入关键词后在这里查未安装技能' };

  let text;
  try {
    text = readFileSync(status.path, 'utf8');
  } catch (error) {
    return { ...status, query: q, hits: [], total: 0, error: error?.message ?? String(error) };
  }
  const { tables, lines } = parseIndex(text);
  const hits = [];
  let total = 0;

  for (const table of tables) {
    for (const row of table.rows) {
      const joined = row.cells.join(' ').toLowerCase();
      if (!joined.includes(q)) continue;
      total += 1;
      if (hits.length < limit) {
        hits.push({ kind: 'table', header: table.header, cells: row.cells, line: row.line });
      }
    }
  }
  for (const entry of lines) {
    if (!entry.text.toLowerCase().includes(q)) continue;
    total += 1;
    if (hits.length < limit) hits.push({ kind: 'line', text: entry.text, line: entry.line });
  }

  return {
    ...status,
    query: q,
    hits,
    total,
    truncated: total > hits.length,
  };
}
