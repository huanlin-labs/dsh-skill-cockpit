/**
 * dsh-skill-panel · frontmatter reader.
 *
 * The runtime's rule (`dsh-skill-filesystem` → `parseFrontmatter` +
 * `parseSkillFile`) is:
 *   1. the FIRST line must be exactly `---`            else dropped
 *   2. a closing `---` line must exist                 else dropped
 *   3. the block must parse as a YAML mapping          else dropped
 *   4. `name` and `description` must both be strings   else dropped
 *   5. the name must look like a skill name            else dropped
 * …and every failure path is a bare `continue`: the skill silently vanishes
 * from the model's catalog. This panel reports the reason instead.
 *
 * Scope note (honesty): steps 1–4 are reproduced exactly. Step 3 uses a
 * purpose-built reader for the mapping subset skill frontmatter actually uses
 * (scalar keys, quoted strings, `|`/`>` blocks, nested lists/maps for
 * `metadata`), because the runtime's YAML engine is not a dependency of this
 * package. It reports `bad-yaml` only for provable breakage (tab indentation,
 * a top-level line without a `:`, an unclosed quote or flow collection, an
 * empty block that YAML would parse as null) — never on a guess.
 */

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const STATUS = Object.freeze({
  OK: 'ok',
  NO_FRONTMATTER: 'dropped:no-frontmatter',
  UNCLOSED: 'dropped:unclosed',
  BAD_YAML: 'dropped:bad-yaml',
  MISSING_FIELDS: 'dropped:missing-fields',
  BAD_NAME: 'dropped:bad-name',
  NO_ENTRY_FILE: 'dropped:no-entry-file',
  READ_ERROR: 'error',
});

/** Strip a single leading BOM; the runtime reads raw text without one. */
function stripBom(raw) {
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}

function findClosingLine(raw, start) {
  let lineStart = start;
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf('\n', lineStart);
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline;
    if (raw.slice(lineStart, lineEnd).replace(/\r$/, '') === '---') {
      return { start: lineStart, bodyStart: nextNewline < 0 ? raw.length : nextNewline + 1 };
    }
    if (nextNewline < 0) return undefined;
    lineStart = nextNewline + 1;
  }
  return undefined;
}

function unquote(value) {
  const text = value.trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  return undefined;
}

/**
 * Parse the frontmatter block into a flat-ish object.
 * @returns {{data: object}|{error: string}}
 */
function parseBlock(block) {
  const lines = block.split('\n');
  const data = Object.create(null);
  let lastKey;
  let blockScalarIndent = null;
  let blockScalarParts = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].replace(/\r$/, '');
    if (blockScalarIndent !== null) {
      const indent = line.length - line.trimStart().length;
      if (line.trim() === '' || indent >= blockScalarIndent) {
        blockScalarParts.push(line.trim());
        continue;
      }
      data[lastKey] = blockScalarParts.join('\n').trim();
      blockScalarIndent = null;
      blockScalarParts = null;
    }
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (/^\s/.test(line)) {
      if (/^\t/.test(line)) return { error: `第 ${i + 1} 行以 Tab 缩进（YAML 不允许）` };
      continue; // nested value of the previous key — accepted, not interpreted
    }
    const match = /^([^:\s][^:]*):(.*)$/.exec(line);
    if (match === null) return { error: `第 ${i + 1} 行不是 "键: 值" 形式：${line.slice(0, 60)}` };
    const key = match[1].trim();
    const rest = match[2];
    const value = rest.trim();
    if (value === '|' || value === '>' || value.startsWith('|') || value.startsWith('>')) {
      blockScalarIndent = 1;
      blockScalarParts = [];
      lastKey = key;
      continue;
    }
    lastKey = key;
    if (value === '') {
      data[key] = '';
      continue;
    }
    const quoted = unquote(value);
    if (quoted !== undefined) {
      data[key] = quoted;
      continue;
    }
    if (value.startsWith('"') || value.startsWith("'")) {
      return { error: `第 ${i + 1} 行引号未闭合：${value.slice(0, 60)}` };
    }
    if (/^[[{]/.test(value)) {
      const opens = (value.match(/[[{]/g) ?? []).length;
      const closes = (value.match(/[\]}]/g) ?? []).length;
      if (opens !== closes) return { error: `第 ${i + 1} 行流式集合未闭合：${value.slice(0, 60)}` };
    }
    if (/^(null|~|Null|NULL)$/.test(value)) {
      data[key] = null;
      continue;
    }
    data[key] = value;
  }
  if (blockScalarIndent !== null) data[lastKey] = blockScalarParts.join('\n').trim();
  return { data };
}

/**
 * @param {string} raw file text
 * @returns {{status:string, data?:object, body?:string, reason?:string}}
 */
export function readFrontmatter(raw) {
  const text = stripBom(raw);
  const firstLineEnd = text.indexOf('\n');
  if (firstLineEnd < 0) {
    return { status: STATUS.NO_FRONTMATTER, reason: '文件只有一行，没有 frontmatter' };
  }
  if (text.slice(0, firstLineEnd).replace(/\r$/, '') !== '---') {
    return { status: STATUS.NO_FRONTMATTER, reason: '首行不是 --- （模型看不到这个技能）' };
  }
  const start = firstLineEnd + 1;
  const closing = findClosingLine(text, start);
  if (closing === undefined) {
    return { status: STATUS.UNCLOSED, reason: '有起始 --- 但没有闭合 ---' };
  }
  const block = text.slice(start, closing.start);
  const parsed = parseBlock(block);
  if (parsed.error !== undefined) {
    return { status: STATUS.BAD_YAML, reason: parsed.error };
  }
  const keys = Object.keys(parsed.data);
  if (keys.length === 0) {
    return { status: STATUS.BAD_YAML, reason: 'frontmatter 为空（YAML 解析结果是 null，不是对象）' };
  }
  return { status: STATUS.OK, data: parsed.data, body: text.slice(closing.bodyStart) };
}

/**
 * Full judgement for one skill entry file.
 * @param {string} raw entry-file text (the file that WOULD be loaded)
 * @returns {{status:string, name?:string, description?:string, whenToUse?:string, body?:string, reason?:string}}
 */
export function judgeSkillFile(raw) {
  const fm = readFrontmatter(raw);
  if (fm.status !== STATUS.OK) return fm;

  const name = typeof fm.data.name === 'string' ? fm.data.name.trim() : undefined;
  const description =
    typeof fm.data.description === 'string' ? fm.data.description.trim() : undefined;
  if (!name || !description) {
    const missing = [!name ? 'name' : null, !description ? 'description' : null].filter(Boolean);
    return {
      status: STATUS.MISSING_FIELDS,
      reason: `frontmatter 缺少非空字符串字段：${missing.join(' / ')}`,
    };
  }
  if (!NAME_PATTERN.test(name)) {
    return {
      status: STATUS.BAD_NAME,
      reason: `技能名 "${name}" 不符合 [A-Za-z0-9][A-Za-z0-9._-]* 约定`,
      name,
      description,
    };
  }
  const whenToUse = typeof fm.data.whenToUse === 'string' ? fm.data.whenToUse : undefined;
  return {
    status: STATUS.OK,
    name,
    description,
    whenToUse,
    body: (fm.body ?? '').trim(),
    raw: fm.data,
  };
}
