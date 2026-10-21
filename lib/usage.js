/**
 * dsh-skill-cockpit · skill usage from the session log.
 *
 * WHY THIS SHAPE (verified 2026-10-19 against real files, not guessed):
 *   A session log is `<dshHome>/sessions/--<cwd>--/<id>/session.vN.jsonl.zstd`.
 *   Despite the name it is NOT one zstd stream: it is a CONCATENATION of
 *   independent zstd frames (one per append), each holding one or more JSONL
 *   event lines. `zlib.zstdDecompressSync(wholeFile)` decodes only the FIRST
 *   frame — that is the trap that makes naive readers return just the session
 *   header. The reliable, dependency-free reader is:
 *     1. find every zstd magic (0x28 B5 2F FD) — candidates for frame starts
 *     2. decode a bounded window from each candidate
 *        (false positives inside compressed payloads throw or yield junk)
 *     3. keep only newline-delimited JSON that parses
 *   Duplicate hits are dropped by remembering decoded event `seq` values.
 *
 * WHAT IT LOOKS FOR — two shapes, both accepted (0.6.9):
 *   1. TOOL CALL (what this host actually writes, verified 2026-10-21 against a
 *      live session): the assistant message holds
 *        { type: 'tool-call', name: 'skill', arguments: '{"name":"<skill>"}' }
 *      inside `data.message.content[]`. `arguments` is a JSON STRING, so it must
 *      be parsed; `name` is the tool name, and the invoked skill is `input.name`.
 *   2. INVOCATION SOURCE (older/other runtimes): a user message tagged with
 *        source: { kind: 'skill-invocation', name: '<skill>' }
 *   We do not assume where in the event tree either one sits: we walk the
 *   parsed event, so the reader survives envelope changes.
 *
 *   WHY BOTH: 0.6.8 only knew shape 2, so every real skill call on this host was
 *   invisible and the panel honestly reported "0 calls" forever.
 *
 * PRIVACY: only skill names, counts and timestamps are kept. No message text,
 * no titles, no cwd is ever stored or returned.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const FRAME_WINDOW = 256 * 1024; // a frame is far smaller than this in practice
const MAX_FILE_BYTES = 96 * 1024 * 1024; // refuse absurd logs rather than OOM
const SESSION_FILE = /^session(\.[a-z0-9]+)?\.jsonl\.zstd$/i;

let zstd = null;
function zstdDecompress(buf) {
  if (zstd === null) {
    try {
      const zlib = require_zlib();
      zstd = typeof zlib.zstdDecompressSync === 'function' ? zlib.zstdDecompressSync : false;
    } catch {
      zstd = false;
    }
  }
  if (zstd === false) return undefined;
  try {
    return zstd(buf);
  } catch {
    return undefined;
  }
}

// ESM-safe access to node:zlib without a top-level import (keeps the module
// usable in tests that stub the environment).
import * as nodeZlib from 'node:zlib';
function require_zlib() {
  return nodeZlib;
}

/** Every session log under `<dshHome>/sessions`, newest first. */
export function findSessionFiles(dshHome) {
  const root = join(dshHome, 'sessions');
  if (!existsSync(root)) return [];
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!SESSION_FILE.test(entry.name)) continue;
      try {
        const info = statSync(full);
        if (info.size > MAX_FILE_BYTES) continue;
        out.push({ file: full, size: info.size, mtimeMs: info.mtimeMs });
      } catch {
        /* unreadable — skip silently; the panel reports counts, not errors here */
      }
    }
  };
  walk(root, 0);
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/** Decode every parseable event line from one session log. */
export function readSessionEvents(file) {
  let buf;
  try {
    buf = readFileSync(file);
  } catch {
    return [];
  }
  if (buf.length < 8 || !buf.subarray(0, 4).equals(MAGIC)) {
    // Not a zstd container (older raw .jsonl): read it as plain text.
    return parseLines(buf.toString('utf8'));
  }

  const events = [];
  const seenSeq = new Set();
  let from = 0;
  let decodedFrames = 0;
  for (;;) {
    const at = buf.indexOf(MAGIC, from);
    if (at < 0) break;
    from = at + MAGIC.length;
    const window = buf.subarray(at, Math.min(buf.length, at + FRAME_WINDOW));
    const plain = zstdDecompress(window);
    if (plain === undefined || plain.length === 0) continue;
    const text = plain.toString('utf8');
    if (text.charCodeAt(0) === 0) continue; // binary junk from a false positive
    let parsedAny = false;
    for (const event of parseLines(text)) {
      parsedAny = true;
      const seq = typeof event.seq === 'number' ? event.seq : undefined;
      if (seq !== undefined) {
        if (seenSeq.has(seq)) continue;
        seenSeq.add(seq);
      }
      events.push(event);
    }
    if (parsedAny) decodedFrames++;
  }
  events.decodedFrames = decodedFrames;
  return events;
}

function parseLines(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.charCodeAt(0) !== 0x7b) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      /* half-decoded tail of a frame — ignore */
    }
  }
  return out;
}

/** `arguments` may be a JSON string (this host) or an already-parsed object. */
function callInput(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || value === '') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Any skill invocation in the event tree — either shape:
 *   { type: 'tool-call', name: 'skill', arguments: '{"name":"<skill>"}' }
 *   { kind: 'skill-invocation', name: '<skill>' }
 */
function skillNamesIn(node, acc, depth = 0) {
  if (node === null || typeof node !== 'object' || depth > 12) return acc;
  if (Array.isArray(node)) {
    for (const item of node) skillNamesIn(item, acc, depth + 1);
    return acc;
  }
  if (node.kind === 'skill-invocation' && typeof node.name === 'string' && node.name !== '') {
    acc.push(node.name);
  }
  if (node.type === 'tool-call' && node.name === 'skill') {
    const input = callInput(node.arguments);
    if (input && typeof input.name === 'string' && input.name !== '') acc.push(input.name);
  }
  for (const key of Object.keys(node)) skillNamesIn(node[key], acc, depth + 1);
  return acc;
}

/** Aggregate invocations per skill from a list of events. */
export function collectInvocations(events) {
  const perSkill = new Map();
  for (const event of events) {
    const names = skillNamesIn(event, []);
    if (names.length === 0) continue;
    const at = typeof event.time === 'number' ? event.time : undefined;
    for (const name of names) {
      const row = perSkill.get(name) ?? { name, count: 0, lastAt: undefined };
      row.count += 1;
      if (at !== undefined && (row.lastAt === undefined || at > row.lastAt)) row.lastAt = at;
      perSkill.set(name, row);
    }
  }
  return [...perSkill.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * Scan sessions and merge into a persisted usage index.
 * Incremental: a file whose (size, mtimeMs) is unchanged since the last scan is
 * skipped, so the panel stays cheap after the first pass.
 */
export function refreshUsage({ dshHome, storePath, maxFiles = 200, now = () => Date.now() }) {
  const files = findSessionFiles(dshHome).slice(0, maxFiles);
  const previous = readStore(storePath);
  const seen = new Map(previous.files.map((f) => [f.file, f]));
  const perSkill = new Map(previous.skills.map((s) => [s.name, { ...s }]));

  let scanned = 0;
  let skipped = 0;
  for (const file of files) {
    const known = seen.get(file.file);
    if (known && known.size === file.size && known.mtimeMs === file.mtimeMs) {
      skipped++;
      continue;
    }
    // A file that GREW was scanned before: its earlier counts are already in the
    // store, so re-scanning it would double-count. Only differencing would be
    // exact; instead we drop that file's previous contribution first.
    if (known) {
      for (const [name, row] of perSkill) {
        const back = known.contributed?.[name] ?? 0;
        if (back > 0) {
          row.count -= back;
          if (row.count <= 0) perSkill.delete(name);
        }
      }
    }
    const events = readSessionEvents(file.file);
    const rows = collectInvocations(events);
    const contributed = {};
    for (const row of rows) {
      contributed[row.name] = row.count;
      const current = perSkill.get(row.name) ?? { name: row.name, count: 0, lastAt: undefined };
      current.count += row.count;
      if (row.lastAt !== undefined && (current.lastAt === undefined || row.lastAt > current.lastAt)) {
        current.lastAt = row.lastAt;
      }
      perSkill.set(row.name, current);
    }
    seen.set(file.file, { file: file.file, size: file.size, mtimeMs: file.mtimeMs, contributed });
    scanned++;
  }

  const store = {
    version: 1,
    updatedAt: now(),
    files: [...seen.values()],
    skills: [...perSkill.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
  writeStore(storePath, store);
  return { scanned, skipped, skills: store.skills, updatedAt: store.updatedAt, sessions: files.length };
}

export function readStore(storePath) {
  if (!storePath || !existsSync(storePath)) return { files: [], skills: [] };
  try {
    const parsed = JSON.parse(readFileSync(storePath, 'utf8'));
    return {
      files: Array.isArray(parsed.files) ? parsed.files : [],
      skills: Array.isArray(parsed.skills) ? parsed.skills : [],
    };
  } catch {
    return { files: [], skills: [] };
  }
}

function writeStore(storePath, store) {
  if (!storePath) return;
  try {
    mkdirSync(dirname(storePath), { recursive: true });
    writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  } catch {
    /* a read-only profile must not break the panel: usage is best-effort */
  }
}
