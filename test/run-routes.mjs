/**
 * Skill panel · HOST-ROUTE self-test with a fake cordis ctx (no dsh needed).
 *
 *   node test/run-routes.mjs [reportDir]
 *
 * Proves the wiring without restarting anything:
 *   · apply() registers all seven routes on the web server;
 *   · GET ping / skills / body / undeclared / usage / checks answer 200 with JSON;
 *   · POST toggle performs the rename, GET + POST on the wrong method give 405;
 *   · a bad body gives 400; a non-local Origin is refused with 403;
 *   · no service is probed: `ctx.get('webServer')` is the only ctx access;
 *   · the usage index is written to the CONFIGURED path (never the real home in
 *     a test run) and the second call skips unchanged logs.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { apply, name, inject } from '../lib/index.js';

const reportDir = resolve(process.argv[2] ?? join(import.meta.dirname, 'out'));
const pkgVersion = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'),
).version;
const checks = [];
const log = [];
function check(label, ok, detail) {
  checks.push({ label, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

// ---- fake cordis surface --------------------------------------------------

const registered = [];
const effects = [];
const fakeWebServer = {
  register(definition) {
    registered.push(definition);
    return () => {};
  },
};
const ctx = {
  // cordis runs the callback immediately and disposes its return value later.
  effect(callback) {
    const disposer = callback();
    effects.push(disposer);
    return () => {
      if (typeof disposer === 'function') disposer();
    };
  },
  get(service) {
    log.push(`ctx.get('${service}')`);
    return service === 'webServer' ? fakeWebServer : undefined;
  },
  inject(names, callback) {
    log.push(`ctx.inject(${JSON.stringify(names)})`);
    return () => {};
  },
};

// A throwaway DSH home: the /usage route writes an index, and a self-test must
// never touch the real `~/.dsh`. It doubles as the custom skill root below.
const BASE = '/__dsh-skill-panel';
const probeRoot = mkdtempSync(join(tmpdir(), 'skill-panel-routes-'));
// The probe skill lives INSIDE the configured DSH home — that is, inside one of
// the only two roots the panel may write to. A fixture anywhere else could no
// longer exercise a real toggle: project/custom roots are read-only by contract.
const probeHome = join(probeRoot, 'dsh-home');
const probeSkill = join(probeHome, 'skills', 'route-probe');
mkdirSync(probeSkill, { recursive: true });
writeFileSync(
  join(probeSkill, 'SKILL.md'),
  '---\nname: route-probe\ndescription: 路由自测探针\n---\n正文\n',
  'utf8',
);

// A file that exists and is readable but is NOT a skill entry: the /body and
// /toggle guards must refuse it (this is the negative fixture).
const outsideDir = join(probeRoot, 'outside');
mkdirSync(outsideDir, { recursive: true });
const outsideFile = join(outsideDir, 'not-a-skill.md');
writeFileSync(outsideFile, 'this file is not a skill entry\n', 'utf8');

const probeStore = join(probeRoot, 'usage.json');

// One fake session log (a real zstd frame) so /usage has something to read and
// the incremental second call has something to skip.
const probeSessionDir = join(probeHome, 'sessions', '--probe--', 's1');
mkdirSync(probeSessionDir, { recursive: true });
writeFileSync(
  join(probeSessionDir, 'session.v2.jsonl.zstd'),
  zstdCompressSync(
    Buffer.from(
      `${JSON.stringify({
        seq: 1,
        time: 1_700_000_000_000,
        source: { kind: 'skill-invocation', name: 'route-probe' },
      })}\n`,
      'utf8',
    ),
  ),
);

apply(ctx, {
  dshHome: probeHome,
  usageStorePath: probeStore,
});

check('导出 name = dsh-skill-cockpit', name === 'dsh-skill-cockpit', name);
check('inject 为空数组（不猜、不探服务）', Array.isArray(inject) && inject.length === 0, JSON.stringify(inject));
check('注册了 24 条路由', registered.length === 24, registered.map((r) => r.path).join(' '));
check(
  '四态路由 /mode 已注册',
  registered.some((r) => r.path === '/__dsh-skill-panel/mode'),
  registered.map((r) => r.path).join(' '),
);
check(
  '预设预览路由 /preset/plan 已注册',
  registered.some((r) => r.path === '/__dsh-skill-panel/preset/plan'),
  registered.map((r) => r.path).join(' '),
);
check(
  '预设应用路由 /preset/apply 已注册',
  registered.some((r) => r.path === '/__dsh-skill-panel/preset/apply'),
  registered.map((r) => r.path).join(' '),
);
check('每条路由都是 kind=exact', registered.every((r) => r.kind === 'exact'));
check('只通过 ctx.get 访问 ctx 服务', log.every((entry) => entry.startsWith("ctx.get('webServer')")), log.join(' '));

// ---- fake http ------------------------------------------------------------

function makeRes() {
  const holder = {};
  return {
    holder,
    writeHead(status, headers) {
      holder.status = status;
      holder.headers = headers;
    },
    end(text) {
      holder.body = text;
      try {
        holder.json = JSON.parse(text);
      } catch {
        holder.json = null;
      }
    },
  };
}

function makeReq(method, url, body, headers = {}) {
  const listeners = {};
  return {
    method,
    url,
    headers,
    on(event, callback) {
      listeners[event] = callback;
      return this;
    },
    destroy() {},
    /** fire the body events the way node does */
    emitBody() {
      if (listeners.data && body !== undefined) {
        listeners.data(Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8'));
      }
      if (listeners.end) listeners.end();
    },
  };
}

async function hit(path, { method = 'GET', body, headers } = {}) {
  // The registered path is bare; the request URL may carry a query string.
  const [routePath] = path.split('?');
  const route = registered.find((r) => r.path === routePath);
  if (!route) throw new Error(`route not registered: ${routePath}`);
  const req = makeReq(method, path, body, headers);
  const res = makeRes();
  const pending = route.handler(req, res);
  req.emitBody();
  await pending;
  return res.holder;
}

try {
  const ping = await hit(`${BASE}/ping`);
  check('GET ping → 200', ping.status === 200, String(ping.status));
  check('ping 报出 11 条路由', Array.isArray(ping.json?.routes) && ping.json.routes.length === 11);
  check('ping 报出未安装索引状态', Boolean(ping.json?.undeclaredIndex));
  check('ping 报出的版本与 package.json 一致', ping.json?.version === pkgVersion, `${ping.json?.version} vs ${pkgVersion}`);

  const skills = await hit(`${BASE}/skills?cwd=${encodeURIComponent(process.cwd())}`);
  check('GET skills → 200 且是扫描报告', skills.status === 200 && Array.isArray(skills.json?.skills));
  check('报告含 6 类根元信息', Array.isArray(skills.json?.roots) && skills.json.roots.length >= 5, String(skills.json?.roots?.length));

  const skillsNoCwd = await hit(`${BASE}/skills`);
  check('不带 cwd 时仍返回报告（项目根留空）', skillsNoCwd.status === 200 && skillsNoCwd.json?.cwd === null, String(skillsNoCwd.json?.cwd));
  check('不带 cwd 时不列项目级根', skillsNoCwd.json?.roots.every((r) => !r.source.startsWith('project-')));

  // ---- 0.3.0 · GET /usage ------------------------------------------------
  const usage1 = await hit(`${BASE}/usage`);
  check('GET usage → 200', usage1.status === 200, String(usage1.status));
  check('usage 返回 ok:true 与 skills 数组', usage1.json?.ok === true && Array.isArray(usage1.json?.skills));
  check(
    'usage 报出扫描口径（scanned / skipped / sessions / updatedAt）',
    typeof usage1.json?.scanned === 'number' &&
      typeof usage1.json?.skipped === 'number' &&
      typeof usage1.json?.sessions === 'number' &&
      typeof usage1.json?.updatedAt === 'number',
    `scanned=${usage1.json?.scanned} skipped=${usage1.json?.skipped} sessions=${usage1.json?.sessions}`,
  );
  check('usage 读到探针会话里的那次调用', usage1.json?.skills?.[0]?.name === 'route-probe' && usage1.json?.skills?.[0]?.count === 1, JSON.stringify(usage1.json?.skills));
  check(
    'usage 索引落在配置的路径（自测绝不写真实 ~/.dsh）',
    usage1.json?.storePath === probeStore,
    usage1.json?.storePath,
  );
  check('usage 索引文件真的生成了', existsSync(probeStore));
  // 存到磁盘的索引仍然只有这三个字段（隐私契约管的是落盘，不是响应）
  let storedRows = null;
  try {
    storedRows = JSON.parse(readFileSync(probeStore, 'utf8')).skills;
  } catch {
    storedRows = null;
  }
  check(
    'usage 索引文件里的技能行只有 name / count / lastAt',
    Array.isArray(storedRows) &&
      storedRows.length > 0 &&
      storedRows.every((row) => Object.keys(row).every((key) => ['name', 'count', 'lastAt'].includes(key))),
  );
  // 响应可以多带一个技能说明（来自 SKILL.md，不是对话内容）
  check(
    'usage 响应附带技能说明（来源是 SKILL.md）',
    (usage1.json?.skills ?? []).every(
      (row) =>
        Object.keys(row).every((key) => ['name', 'count', 'lastAt', 'description'].includes(key)) &&
        typeof row.description === 'string',
    ),
  );
  check('usage 明说不存对话内容', String(usage1.json?.privacy).includes('不存任何对话内容'), usage1.json?.privacy);
  check(
    'usage 索引文本里没有任何会话正文（只有技能名）',
    !readFileSync(probeStore, 'utf8').includes('正文'),
  );

  const usage2 = await hit(`${BASE}/usage`);
  check('第二次调用增量跳过未变化的会话日志', usage2.json?.skipped >= 1 && usage2.json?.scanned === 0, `skipped=${usage2.json?.skipped} scanned=${usage2.json?.scanned}`);
  check('增量后计数没有翻倍', usage2.json?.skills?.[0]?.count === 1, JSON.stringify(usage2.json?.skills));

  // ---- 0.3.0 · GET /checks ------------------------------------------------
  const checksResp = await hit(`${BASE}/checks?cwd=${encodeURIComponent(process.cwd())}`);
  check('GET checks → 200', checksResp.status === 200, String(checksResp.status));
  check('checks 返回 ok:true 与 checks 数组', checksResp.json?.ok === true && Array.isArray(checksResp.json?.checks));
  check(
    'checks 给出四类汇总计数',
    ['shadowed', 'shortDescription', 'dirNameMismatch', 'emptyBody'].every(
      (key) => typeof checksResp.json?.summary?.[key] === 'number',
    ),
    JSON.stringify(checksResp.json?.summary),
  );
  check(
    'checks 对真实扫描给出真实命中（route-probe 描述只有 6 字）',
    (checksResp.json?.checks ?? []).some((row) => row.skill === 'route-probe' && row.kind === 'short-description'),
    (checksResp.json?.checks ?? []).map((row) => `${row.kind}:${row.skill}`).join(' '),
  );
  check(
    'checks 每条都带 {kind, skill, detail}',
    (checksResp.json?.checks ?? []).every((row) => row.kind && row.skill && row.detail),
  );
  check('checks 讲明正文按文件字节估计', String(checksResp.json?.note).includes('按文件字节估计'), checksResp.json?.note);
  check('checks 带回被扫描的条目数', typeof checksResp.json?.scannedSkills === 'number');

  const checksNoCwd = await hit(`${BASE}/checks`);
  check('checks 不带 cwd 也能答（只看用户级根）', checksNoCwd.status === 200 && checksNoCwd.json?.cwd === null);

  const wrongMethod = await hit(`${BASE}/skills`, { method: 'POST', body: {} });
  check('GET 路由用 POST → 405', wrongMethod.status === 405, String(wrongMethod.status));

  const badBody = await hit(`${BASE}/toggle`, { method: 'POST', body: 'not json' });
  check('坏 JSON → 400', badBody.status === 400, `${badBody.status} ${badBody.json?.error}`);

  const foreign = await hit(`${BASE}/skills`, { headers: { origin: 'https://evil.example.com' } });
  check('外部 Origin → 403', foreign.status === 403, String(foreign.status));

  const localOrigin = await hit(`${BASE}/skills`, { headers: { origin: 'http://127.0.0.1:19387' } });
  check('本机 Origin → 200', localOrigin.status === 200, String(localOrigin.status));

  // toggle on a real (temporary) skill by declaring it as a writable custom root
  const toggleCtxRoutes = registered.find((r) => r.path === `${BASE}/toggle`);
  check('toggle 路由存在', Boolean(toggleCtxRoutes));

  const body = await hit(`${BASE}/undeclared?q=zzz-no-such-skill-zzz`);
  check('GET undeclared → 200（无命中也不报错）', body.status === 200 && Array.isArray(body.json?.hits), `${body.status} hits=${body.json?.hits?.length}`);

  const readBody = await hit(`${BASE}/body`);
  check('GET body 缺参数 → 400', readBody.status === 400, `${readBody.status} ${readBody.json?.error}`);

  // 0.3.2 · cwd is OPTIONAL: the panel is also a standalone page with no session.
  // Without a cwd the report still covers every user-level root, so the whitelist
  // still holds — it merely has no project-level entries to vouch for.
  const readBodyNoCwd = await hit(`${BASE}/body?path=${encodeURIComponent(join(probeSkill, 'SKILL.md'))}`);
  check(
    'GET body 不带 cwd → 200（白名单退化为用户级根，仍只放报告里的入口）',
    readBodyNoCwd.status === 200 && typeof readBodyNoCwd.json?.text === 'string',
    `${readBodyNoCwd.status} ${readBodyNoCwd.json?.error}`,
  );

  const readBodyOk = await hit(
    `${BASE}/body?path=${encodeURIComponent(join(probeSkill, 'SKILL.md'))}&cwd=${encodeURIComponent(probeRoot)}`,
  );
  check('GET body → 200 且读到正文', readBodyOk.status === 200 && typeof readBodyOk.json?.text === 'string' && readBodyOk.json.text.includes('route-probe'));

  // ---- 0.3.1 · the two refusal contracts (negative tests) -----------------
  const readBodyOutside = await hit(
    `${BASE}/body?path=${encodeURIComponent(outsideFile)}&cwd=${encodeURIComponent(probeRoot)}`,
  );
  check(
    'GET body 读报告之外的真实文件 → 403（不再是任意文件读）',
    readBodyOutside.status === 403 && readBodyOutside.json?.ok === false,
    `${readBodyOutside.status} ${readBodyOutside.json?.error}`,
  );
  check('被拒绝的 /body 不回传任何文件内容', typeof readBodyOutside.json?.text === 'undefined');

  const readBodySens = await hit(
    `${BASE}/body?path=${encodeURIComponent(join(probeRoot, 'dsh-home', 'usage.json'))}&cwd=${encodeURIComponent(probeRoot)}`,
  );
  check('GET body 读插件自己的数据文件 → 403（白名单只放技能入口）', readBodySens.status === 403, String(readBodySens.status));

  // 0.3.2 · cwd is OPTIONAL for the write too: the write-root gate is the real
  // boundary, and the standalone page has no session to supply one. Requiring it
  // only broke the panel's own switch without adding any protection.
  const toggleNoCwd = await hit(`${BASE}/toggle`, {
    method: 'POST',
    body: { filePath: join(probeSkill, 'SKILL.md'), disable: true },
  });
  check(
    'toggle 不带 cwd → 200（写根门独立于会话）',
    toggleNoCwd.status === 200,
    `${toggleNoCwd.status} ${toggleNoCwd.json?.error}`,
  );
  check('不带 cwd 的 toggle 真的改名了', existsSync(join(probeSkill, 'SKILL.md.disabled')));

  const restoreNoCwd = await hit(`${BASE}/toggle`, {
    method: 'POST',
    body: { filePath: join(probeSkill, 'SKILL.md.disabled'), disable: false },
  });
  check(
    '不带 cwd 也能改回来',
    restoreNoCwd.status === 200 && existsSync(join(probeSkill, 'SKILL.md')),
    `${restoreNoCwd.status} ${restoreNoCwd.json?.error}`,
  );

  // A cwd that does not resolve must not become a way around the write-root gate.
  const ghostCwd = await hit(`${BASE}/toggle`, {
    method: 'POST',
    body: { filePath: outsideFile, disable: true, cwd: join(probeRoot, 'no-such-cwd') },
  });
  check(
    '不存在的 cwd 不会变成绕过写根门的后门 → 403',
    ghostCwd.status === 403 && String(ghostCwd.json?.error).includes('可写技能根'),
    `${ghostCwd.status} ${ghostCwd.json?.error}`,
  );

  const toggleOutside = await hit(`${BASE}/toggle`, {
    method: 'POST',
    body: { filePath: outsideFile, disable: true, cwd: probeRoot },
  });
  check(
    'toggle 目标不在两个写根内 → 403',
    toggleOutside.status === 403 && String(toggleOutside.json?.error).includes('可写技能根'),
    `${toggleOutside.status} ${toggleOutside.json?.error}`,
  );
  check('被拒绝的 toggle 没有动到根外文件', existsSync(outsideFile));

  const toggleOk = await hit(`${BASE}/toggle`, {
    method: 'POST',
    body: { filePath: join(probeSkill, 'SKILL.md'), disable: true, cwd: probeRoot },
  });
  check(
    'cwd 可解析 + 目标在可写根内 → 真改名',
    toggleOk.status === 200 && toggleOk.json?.applied === true,
    `${toggleOk.status} ${JSON.stringify(toggleOk.json?.error ?? toggleOk.json?.source)}`,
  );
  check('改名后入口变成 .disabled', existsSync(join(probeSkill, 'SKILL.md.disabled')) && !existsSync(join(probeSkill, 'SKILL.md')));

  const toggleBack = await hit(`${BASE}/toggle`, {
    method: 'POST',
    body: { filePath: join(probeSkill, 'SKILL.md.disabled'), disable: false, cwd: probeRoot },
  });
  check('再点一次恢复原名（applied + 名字回来）', toggleBack.status === 200 && existsSync(join(probeSkill, 'SKILL.md')), String(toggleBack.status));
  // ---- 预设页：列 / 挂 / 卸的闭环（0.6.34）---------------------------------
  const presetId = 'route-preset';
  const presetDir = join(probeHome, '.agent-presets', presetId);
  mkdirSync(join(presetDir, 'skills'), { recursive: true });
  writeFileSync(join(presetDir, 'preset.yml'), 'name: 路由预设\ndescription: 测试\norder: 1\n', 'utf8');

  const list0 = await hit(`${BASE}/presets`);
  check(
    'GET /presets → 200 且列出预设与全局技能库',
    list0.status === 200 &&
      list0.json?.presets?.length === 1 &&
      list0.json?.pool?.some((row) => row.name === 'route-probe'),
    `${list0.status} presets=${list0.json?.presets?.length} pool=${list0.json?.pool?.length}`,
  );
  check('预设页提示要重启 dsh 才生效', String(list0.json?.note ?? '').includes('重启'));

  const mount = await hit(`${BASE}/presets/mount`, {
    method: 'POST',
    body: { presetId, skillName: 'route-probe' },
  });
  const linkPath = join(presetDir, 'skills', 'route-probe');
  check(
    'POST /presets/mount → 建出 junction',
    mount.status === 200 && mount.json?.ok === true && lstatSync(linkPath).isSymbolicLink(),
    `${mount.status} ${mount.json?.error ?? ''}`,
  );
  check('挂载后技能本体仍在原位', existsSync(join(probeSkill, 'SKILL.md')));

  const list1 = await hit(`${BASE}/presets`);
  const mountedRow = list1.json?.presets?.[0]?.mounted?.find((row) => row.name === 'route-probe');
  check(
    'GET /presets 报出已挂技能并标为链接',
    mountedRow?.link === true && mountedRow?.hasSkill === true,
    JSON.stringify(mountedRow ?? null),
  );

  const unmount = await hit(`${BASE}/presets/unmount`, {
    method: 'POST',
    body: { presetId, skillName: 'route-probe' },
  });
  check(
    'POST /presets/unmount → 只删链接，本体不动',
    unmount.status === 200 &&
      unmount.json?.ok === true &&
      !existsSync(linkPath) &&
      existsSync(join(probeSkill, 'SKILL.md')),
    `${unmount.status} ${unmount.json?.error ?? ''}`,
  );

  // 预设自带的真实目录：移出 = 搬到全局技能库，不删内容
  const builtinDir = join(presetDir, 'skills', 'builtin-skill')
  mkdirSync(builtinDir, { recursive: true })
  writeFileSync(join(builtinDir, 'SKILL.md'), '---\nname: builtin-skill\ndescription: builtin\n---\nbody\n', 'utf8')

  const detach = await hit(`${BASE}/presets/detach`, {
    method: 'POST',
    body: { presetId, skillName: 'builtin-skill' },
  })
  check(
    'POST /presets/detach → 真实目录移到全局库',
    detach.status === 200 &&
      detach.json?.ok === true &&
      !existsSync(builtinDir) &&
      existsSync(join(probeHome, 'skills', 'builtin-skill', 'SKILL.md')),
    `${detach.status} ${detach.json?.error ?? ''}`,
  )

  const detachLink = await hit(`${BASE}/presets/detach`, {
    method: 'POST',
    body: { presetId, skillName: 'route-probe' },
  })
  check('对链接调用 detach → 拒绝', detachLink.status === 400 && detachLink.json?.ok === false, detachLink.json?.error)

  const badId = await hit(`${BASE}/presets/mount`, {
    method: 'POST',
    body: { presetId: '..', skillName: 'route-probe' },
  });
  check('预设 id 路径穿越 → 拒绝', badId.status === 400 && badId.json?.ok === false, `${badId.status} ${badId.json?.error}`);

  const badSkill = await hit(`${BASE}/presets/mount`, {
    method: 'POST',
    body: { presetId, skillName: 'no-such-skill' },
  });
  check(
    '挂不存在的技能 → 拒绝',
    badSkill.status === 400 && badSkill.json?.ok === false,
    `${badSkill.status} ${badSkill.json?.error}`,
  );
} finally {
  rmSync(probeRoot, { recursive: true, force: true });
}

// After cleanup the probe tree is gone: a toggle must still be refused, not applied.
const refused = await hit(`${BASE}/toggle`, {
  method: 'POST',
  body: { filePath: join(probeRoot, 'gone.md'), disable: true, cwd: probeRoot },
});
check('toggle 目标不存在 → 400/403 拒绝', refused.status === 400 || refused.status === 403, `${refused.status} ${refused.json?.error}`);
check('没有留下任何探针文件', !existsSync(probeRoot));

mkdirSync(reportDir, { recursive: true });
writeFileSync(join(reportDir, 'routes-report.json'), JSON.stringify({ checks, log, registered: registered.map((r) => r.path) }, null, 2));
console.log(`\n报告已写：${join(reportDir, 'routes-report.json')}`);

const failed = checks.filter((c) => !c.ok);
console.log(`\n=== 路由自测：${checks.length - failed.length}/${checks.length} 通过 ===`);
process.exit(failed.length === 0 ? 0 : 1);
