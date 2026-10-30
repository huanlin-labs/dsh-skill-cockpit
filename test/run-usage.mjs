/**
 * Skill panel · lib/usage.js self-test (real zstd frames, throwaway DSH home).
 *
 *   node test/run-usage.mjs [reportDir]
 *
 * WHY THE FIXTURES ARE BUILT FRAME BY FRAME: a real session log is
 * `<dshHome>/sessions/--<cwd>--/<id>/session.vN.jsonl.zstd` and — despite the
 * suffix — it is a CONCATENATION of independent zstd frames, one per append.
 * `zstdDecompressSync(wholeFile)` therefore decodes only the FIRST frame, which
 * is the trap this reader exists to avoid. The only honest way to test that is
 * to compress each frame separately and concatenate them, which is what
 * `writeFrames()` below does.
 *
 * Covered: multi-frame decode · single frame · plain-text fallback · garbage ·
 * event filtering (deep nesting included) · seq dedupe · aggregation/sorting ·
 * incremental skip · growth without double counting · store persistence ·
 * privacy (no conversation text on disk) · file discovery rules.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import zlib from 'node:zlib';
import { zstdAvailable } from '../lib/usage.js';
if (typeof zlib.zstdCompressSync !== 'function') {
  console.log(`SKIP  run-usage：当前 Node ${process.version} 没有 zstd API（需要 Node 24+），本套件跳过`);
  process.exit(0);
}
if (!zstdAvailable()) {
  console.log('FAIL  zstdAvailable() 应为 true（本套件本来就要求有 zstd）');
  process.exit(1);
}
console.log('PASS  zstdAvailable() 为 true');
if (typeof zlib.zstdCompressSync !== 'function') {
  console.log(`SKIP  run-usage：当前 Node ${process.version} 没有 zstd API（需要 Node 24+），本套件跳过`);
  process.exit(0);
}
const zstdCompressSync = zlib.zstdCompressSync;
import {
  collectInvocations,
  findSessionFiles,
  readSessionEvents,
  readStore,
  refreshUsage,
} from '../lib/usage.js';

const reportDir = resolve(process.argv[2] ?? join(import.meta.dirname, 'out'));
const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

// ---- fixture helpers ------------------------------------------------------

/** A conversation sentence that must NEVER reach the store. */
const PRIVATE_TEXT = '这是绝不该落盘的对话原文：户主问了技能面板怎么用。';

/** One skill-invocation event, shaped like the host's envelope. */
function invocation(seq, time, name, extra = {}) {
  return {
    seq,
    time,
    type: 'message',
    source: { kind: 'skill-invocation', name, form: 'instructions' },
    text: PRIVATE_TEXT,
    ...extra,
  };
}

/** Compress each frame on its own, then concatenate — exactly how the host appends. */
function writeFrames(file, frames) {
  const parts = frames.map((frame) => {
    const lines = frame.map((event) => JSON.stringify(event)).join('\n') + '\n';
    return zstdCompressSync(Buffer.from(lines, 'utf8'));
  });
  writeFileSync(file, Buffer.concat(parts));
  return Buffer.concat(parts).length;
}

function appendFrame(file, events) {
  const lines = events.map((event) => JSON.stringify(event)).join('\n') + '\n';
  const existing = existsSync(file) ? readFileSync(file) : Buffer.alloc(0);
  writeFileSync(file, Buffer.concat([existing, zstdCompressSync(Buffer.from(lines, 'utf8'))]));
}

const root = mkdtempSync(join(tmpdir(), 'skill-panel-usage-'));
const dshHome = join(root, 'dsh');
const sessionsRoot = join(dshHome, 'sessions');
const projectDir = join(sessionsRoot, '--D-工作区--', 'sess-multi');
const storePath = join(root, 'store', 'usage.json');

try {
  // ---- 1. findSessionFiles -------------------------------------------------
  check('sessions 根不存在时返回空数组（不抛）', findSessionFiles(join(root, 'nope')).length === 0);

  mkdirSync(projectDir, { recursive: true });
  const multiFile = join(projectDir, 'session.v2.jsonl.zstd');
  writeFrames(multiFile, [
    [invocation(1, 1000, 'canvas-design')],
    [invocation(2, 2000, 'canvas-design')],
    [invocation(3, 3000, 'office-docx')],
  ]);

  const found = findSessionFiles(dshHome);
  check('findSessionFiles 找到 1 个会话日志', found.length === 1, String(found.length));
  check('会话日志带文件大小与 mtime', typeof found[0].size === 'number' && typeof found[0].mtimeMs === 'number');
  check('会话日志路径就是刚写的那个', found[0].file === multiFile);

  // 非会话文件名必须被忽略
  const ignoredFile = join(projectDir, 'notes.txt');
  writeFileSync(ignoredFile, '不是会话日志', 'utf8');
  check('非 session*.jsonl.zstd 文件不入选', findSessionFiles(dshHome).length === 1);

  // 排序：新的在前
  const olderDir = join(sessionsRoot, '--D-工作区--', 'sess-older');
  mkdirSync(olderDir, { recursive: true });
  const olderFile = join(olderDir, 'session.v1.jsonl.zstd');
  writeFrames(olderFile, [[invocation(1, 500, 'old-skill')]]);
  const nowSec = Date.now() / 1000;
  utimesSync(olderFile, nowSec - 5000, nowSec - 5000);
  const ordered = findSessionFiles(dshHome);
  check('返回 2 个会话日志', ordered.length === 2, String(ordered.length));
  check('按 mtime 从新到旧排序', ordered[0].file === multiFile && ordered[1].file === olderFile);

  // ---- 2. 多帧解码（本套件的核心：不是只解第一帧） -------------------------
  const multi = readSessionEvents(multiFile);
  check('多帧文件解出 3 条事件（整文件解压只会得到 1 条）', multi.length === 3, String(multi.length));
  check('3 条事件分别来自 3 个独立帧', multi.decodedFrames === 3, String(multi.decodedFrames));
  check(
    '三个技能调用名都读到了',
    multi.filter((event) => event.source?.kind === 'skill-invocation').map((event) => event.source.name).join(',') ===
      'canvas-design,canvas-design,office-docx',
  );

  // 单帧
  const oneFrame = join(root, 'one-frame.jsonl.zstd');
  writeFrames(oneFrame, [[invocation(1, 1000, 'solo-skill'), invocation(2, 1100, 'solo-skill')]]);
  check('单帧两行 → 2 条事件', readSessionEvents(oneFrame).length === 2);

  // 纯文本 .jsonl 回退（老格式，没有 zstd magic）
  const plainFile = join(root, 'plain.jsonl.zstd');
  writeFileSync(plainFile, `${JSON.stringify(invocation(1, 1000, 'plain-skill'))}\n`, 'utf8');
  check('没有 zstd magic 的纯文本按文本读', readSessionEvents(plainFile).length === 1);

  // 垃圾字节
  const junkFile = join(root, 'junk.jsonl.zstd');
  writeFileSync(junkFile, Buffer.from('这不是 zstd，也不是 JSON，只是一串垃圾字节……', 'utf8'));
  let junkThrew = false;
  let junkResult = null;
  try {
    junkResult = readSessionEvents(junkFile);
  } catch {
    junkThrew = true;
  }
  check('垃圾字节不抛错', junkThrew === false);
  check('垃圾字节返回空数组', Array.isArray(junkResult) && junkResult.length === 0, String(junkResult?.length));
  check('读不存在的文件返回空数组', readSessionEvents(join(root, 'missing.jsonl.zstd')).length === 0);

  // 半截帧（末尾被截断）仍然尽量读出前面的整帧
  const truncatedFile = join(root, 'truncated.jsonl.zstd');
  const full = readFileSync(multiFile);
  writeFileSync(truncatedFile, full.subarray(0, full.length - 10));
  const truncated = readSessionEvents(truncatedFile);
  check('末尾帧被截断时前面的帧照读（不掉整份）', truncated.length >= 2, String(truncated.length));

  // ---- 3. seq 去重 ---------------------------------------------------------
  const dupFile = join(root, 'dup.jsonl.zstd');
  writeFrames(dupFile, [
    [invocation(7, 1000, 'dup-skill')],
    [invocation(7, 1000, 'dup-skill')], // 跨帧重叠：同一 seq
  ]);
  check('同一 seq 跨帧重复只保留一条', readSessionEvents(dupFile).length === 1);
  check(
    '去重后聚合也只算一次',
    collectInvocations(readSessionEvents(dupFile))[0]?.count === 1,
    String(collectInvocations(readSessionEvents(dupFile))[0]?.count),
  );

  // ---- 4. 事件筛选与聚合 ---------------------------------------------------
  const deep = {
    seq: 20,
    time: 9000,
    payload: { data: { blocks: [{ source: { kind: 'skill-invocation', name: 'deep-skill' } }] } },
  };
  const mixed = [
    invocation(1, 1000, 'a-skill'),
    invocation(2, 2000, 'a-skill'),
    invocation(3, 3000, 'b-skill'),
    { seq: 4, time: 4000, source: { kind: 'user', name: 'not-a-skill' } },
    { seq: 5, time: 5000, source: { kind: 'skill-invocation' } },
    { seq: 6, time: 6000, source: { kind: 'skill-invocation', name: '' } },
    deep,
    { seq: 7, time: 7000, type: 'plain' },
  ];
  const aggregate = collectInvocations(mixed);
  check('只统计 kind=skill-invocation 且 name 非空的 3 个技能', aggregate.length === 3, JSON.stringify(aggregate.map((r) => r.name)));
  check('深层嵌套里的事件同样被计入', aggregate.some((row) => row.name === 'deep-skill'));
  check('kind 不同不计入（user）', !aggregate.some((row) => row.name === 'not-a-skill'));
  check('缺 name 不计入（不会凭空造一个空技能）', !aggregate.some((row) => row.name === ''));
  check('同技能多次调用累加', aggregate.find((row) => row.name === 'a-skill')?.count === 2);
  check('按次数降序（a-skill 2 次排第一）', aggregate[0].name === 'a-skill', aggregate[0].name);
  check(
    '次数相同按名字排序',
    collectInvocations([invocation(1, 1, 'zeta'), invocation(2, 2, 'alpha')])[0].name === 'alpha',
  );
  check(
    'lastAt 取最大值',
    collectInvocations([invocation(1, 5000, 'x'), invocation(2, 3000, 'x')])[0].lastAt === 5000,
  );
  check('没有 time 字段时不编造 lastAt', collectInvocations([{ seq: 1, source: { kind: 'skill-invocation', name: 'no-time' } }])[0].lastAt === undefined);

  // ---- 4b. 宿主实际写法：content 里的 tool-call(name='skill') ---------------
  // 2026-10-21 实测：真实调用长这样，0.6.8 只认 kind='skill-invocation' 所以永远数不到。
  const toolCall = (seq, time, args) => ({
    seq,
    time,
    type: 'assistant/message',
    data: {
      message: {
        content: [
          { type: 'reasoning', text: 'think' },
          { type: 'tool-call', id: `call_${seq}`, name: 'skill', arguments: args },
        ],
      },
    },
  });
  const oneCall = collectInvocations([toolCall(1, 1000, JSON.stringify({ name: 'debugging' }))]);
  check('识别 tool-call 形态的技能调用', oneCall[0]?.name === 'debugging', JSON.stringify(oneCall));
  check('tool-call 形态只算 1 次', oneCall[0]?.count === 1, String(oneCall[0]?.count));
  check('tool-call 形态带上 lastAt', oneCall[0]?.lastAt === 1000, String(oneCall[0]?.lastAt));
  check(
    'arguments 已是对象（非字符串）也能识别',
    collectInvocations([toolCall(1, 1, { name: 'code-review' })])[0]?.name === 'code-review',
  );
  check(
    '非 skill 的 tool-call 不计入',
    collectInvocations([toolCall(1, 1, JSON.stringify({ file_path: 'x' }))].map((e) => {
      e.data.message.content[1].name = 'read';
      return e;
    })).length === 0,
  );
  check('skill 的 arguments 是坏 JSON 时不计入', collectInvocations([toolCall(1, 1, '{oops')]).length === 0);
  check('arguments 缺 name 时不计入', collectInvocations([toolCall(1, 1, JSON.stringify({ foo: 1 }))]).length === 0);
  check(
    '两种形态并存时都计入',
    collectInvocations([invocation(1, 10, 'debugging'), toolCall(2, 20, JSON.stringify({ name: 'debugging' }))])[0]?.count === 2,
  );

  // ---- 5. refreshUsage：首次全扫 ------------------------------------------
  let nowValue = 1_700_000_000_000;
  const first = refreshUsage({ dshHome, storePath, now: () => nowValue });
  check('首次：扫描了 2 个会话', first.sessions === 2 && first.scanned === 2, `sessions=${first.sessions} scanned=${first.scanned}`);
  check('首次：没有跳过任何文件', first.skipped === 0);
  check('首次：canvas-design 计 2 次', first.skills.find((row) => row.name === 'canvas-design')?.count === 2);
  check('首次：office-docx 计 1 次', first.skills.find((row) => row.name === 'office-docx')?.count === 1);
  check('首次：older 会话的技能也在（增量会扫全部会话根）', first.skills.some((row) => row.name === 'old-skill'));
  check('首次：updatedAt 用注入的时钟', first.updatedAt === nowValue, String(first.updatedAt));

  // ---- 6. 落盘结构与隐私 ---------------------------------------------------
  check('usage.json 真的写出来了', existsSync(storePath));
  const storeText = readFileSync(storePath, 'utf8');
  const store = JSON.parse(storeText);
  check(
    '落盘结构是 {version, updatedAt, files, skills}',
    store.version === 2 && typeof store.updatedAt === 'number' && Array.isArray(store.files) && Array.isArray(store.skills),
    Object.keys(store).join(','),
  );
  check('落盘文件表记录 size/mtimeMs/contributed', store.files.every((f) => f.size && f.mtimeMs !== undefined && f.contributed !== undefined));
  check('技能行只有 name/count/lastAt 三个字段', store.skills.every((row) => {
    const keys = Object.keys(row).sort().join(',');
    return keys === 'count,lastAt,name' || keys === 'count,name';
  }), JSON.stringify(store.skills[0]));
  check('隐私：落盘文本不含任何对话原文', !storeText.includes(PRIVATE_TEXT));
  check('隐私：落盘文本不含事件正文里的关键词', !storeText.includes('绝不该落盘'));
  check('落盘文本里只有技能名（可以核对）', storeText.includes('canvas-design'));

  // ---- 7. 增量：同尺寸同 mtime → 全跳过 ------------------------------------
  nowValue += 1000;
  const second = refreshUsage({ dshHome, storePath, now: () => nowValue });
  check('第二次：2 个文件全部跳过', second.skipped === 2 && second.scanned === 0, `skipped=${second.skipped} scanned=${second.scanned}`);
  check('第二次：计数不翻倍（canvas-design 仍是 2）', second.skills.find((row) => row.name === 'canvas-design')?.count === 2);
  check('第二次：updatedAt 前进', second.updatedAt === nowValue);

  // ---- 8. 增量：文件变大 → 重扫且不双计 --------------------------------
  appendFrame(multiFile, [invocation(4, 4000, 'canvas-design')]);
  nowValue += 1000;
  const third = refreshUsage({ dshHome, storePath, now: () => nowValue });
  check('增长后：只重扫变化的那 1 个文件', third.scanned === 1 && third.skipped === 1, `scanned=${third.scanned} skipped=${third.skipped}`);
  check(
    '增长后：canvas-design 是 3 次而不是 5 次（先扣旧贡献再重扫）',
    third.skills.find((row) => row.name === 'canvas-design')?.count === 3,
    String(third.skills.find((row) => row.name === 'canvas-design')?.count),
  );

  // ---- 9. maxFiles 上限 ----------------------------------------------------
  const limited = refreshUsage({ dshHome, storePath: join(root, 'store', 'limited.json'), maxFiles: 1, now: () => nowValue });
  check('maxFiles 生效：只考虑 1 个会话', limited.sessions === 1, String(limited.sessions));

  // ---- 10. readStore 的容错 -------------------------------------------------
  check('readStore 对不存在的路径返回空结构', (() => {
    const empty = readStore(join(root, 'nope', 'usage.json'));
    return Array.isArray(empty.files) && Array.isArray(empty.skills) && empty.files.length === 0;
  })());
  const brokenPath = join(root, 'broken.json');
  writeFileSync(brokenPath, '{ 这不是 JSON', 'utf8');
  check('readStore 对坏 JSON 返回空结构（不让面板崩）', readStore(brokenPath).skills.length === 0);
  const stalePath = join(root, 'stale.json');
  writeFileSync(stalePath, JSON.stringify({ version: 1, files: [{ file: 'x', size: 1, mtimeMs: 1, contributed: {} }], skills: [{ name: 'ghost', count: 9 }] }), 'utf8');
  check('旧版 store（version 1）被整份丢弃，强制全量重扫', readStore(stalePath).files.length === 0 && readStore(stalePath).skills.length === 0);
  check('readStore 能读回刚写的 store', readStore(storePath).skills.length >= 3, String(readStore(storePath).skills.length));

  // ---- 11. 空态：一个调用都没有的新机器 -----------------------------------
  const emptyHome = join(root, 'empty-dsh');
  mkdirSync(join(emptyHome, 'sessions', '--x--', 's1'), { recursive: true });
  writeFrames(join(emptyHome, 'sessions', '--x--', 's1', 'session.v2.jsonl.zstd'), [
    [{ seq: 1, time: 1, type: 'message', text: PRIVATE_TEXT }],
  ]);
  const emptyResult = refreshUsage({ dshHome: emptyHome, storePath: join(root, 'store', 'empty.json'), now: () => 1 });
  check('有会话但 0 次技能调用 → skills 为空数组', Array.isArray(emptyResult.skills) && emptyResult.skills.length === 0);
  check('空态下 sessions 仍如实报出（UI 要用它写「最近 M 个会话」）', emptyResult.sessions === 1, String(emptyResult.sessions));
} finally {
  rmSync(root, { recursive: true, force: true });
}

check('临时目录用完即删', !existsSync(root));

mkdirSync(reportDir, { recursive: true });
writeFileSync(
  join(reportDir, 'usage-report.json'),
  JSON.stringify({ checks }, null, 2),
);
console.log(`\n报告已写：${join(reportDir, 'usage-report.json')}`);

const failed = checks.filter((row) => !row.ok);
console.log(`\n=== 用量套件自测：${checks.length - failed.length}/${checks.length} 通过 ===`);
process.exit(failed.length === 0 ? 0 : 1);
