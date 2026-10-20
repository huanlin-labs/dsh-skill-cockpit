/**
 * Skill panel · CLIENT-half smoke test (no browser, no dsh).
 *
 *   node test/run-client.mjs [reportDir]
 *
 * lib/client.js is a classic script for DSH's client-modules protocol, so this
 * test fakes exactly that protocol — `window.__ModuleLoader__.load({id,factory})`
 * plus a `require('react')` stub — and then:
 *   1. evaluates the bundle and checks the exports (`apply` / `inject`);
 *   2. runs `apply(ctx)` against a fake `slots` service and asserts the MOUNT
 *      SURFACE: one `sidebar.panellist` row (id / order / label) plus one `main`
 *      keyed page under the same key — the official global-panel pair;
 *   3. renders the page with a hook harness in four states — a healthy scan, a
 *      scan containing a `dropped:*` entry, an undeclared-index hit and the
 *      no-`useSessions` fallback — and asserts each is really drawn.
 *
 * It cannot verify pixels or the real shell; that needs dsh running again
 * (see the assembly checklist). It does catch the class of bug that matters
 * here: a bundle that never evaluates, a wrong row descriptor or order, a page
 * registered under a key the row cannot address, a render crash, a branch that
 * silently renders nothing.
 */

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const reportDir = resolve(process.argv[2] ?? join(import.meta.dirname, 'out'));
const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

// ---- fake client-modules protocol ----------------------------------------

let captured = null;
globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      captured = definition;
    },
  },
};

/** Minimal React stub: hooks return preset values by call order. */
function makeReact(preset = {}) {
  let index = 0;
  const boxes = [];
  return {
    boxes,
    createElement(type, props, ...children) {
      return {
        type,
        props: props ?? {},
        children: children.flat().filter((c) => c !== null && c !== undefined && c !== false && c !== true),
      };
    },
    useState(initial) {
      const i = index;
      index += 1;
      if (!(i in boxes)) {
        boxes[i] = Object.prototype.hasOwnProperty.call(preset, i)
          ? typeof preset[i] === 'function'
            ? preset[i](initial)
            : preset[i]
          : initial;
      }
      return [boxes[i], () => {}];
    },
    useEffect() {},
    useMemo(fn) {
      return fn();
    },
    useCallback(fn) {
      return fn;
    },
  };
}

/** Expand a React element tree: call function components, keep host elements. */
function expand(node, depth = 0) {
  if (node === null || node === undefined || node === false || node === true) return null;
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map((n) => expand(n, depth)).filter((n) => n !== null);
  if (typeof node !== 'object') return null;
  if (depth > 40) return null;
  const children = (node.children ?? []).map((c) => expand(c, depth + 1)).filter((c) => c !== null);
  if (typeof node.type === 'function') {
    return expand(node.type({ ...node.props, children: children.length === 1 ? children[0] : children }), depth + 1);
  }
  return { type: node.type, props: node.props, children };
}

function collectText(node, out = []) {
  if (node === null) return out;
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
    return out;
  }
  for (const child of node.children ?? []) collectText(child, out);
  return out;
}

function countType(node, target, out = { n: 0 }) {
  if (node === null) return out;
  if (Array.isArray(node)) {
    for (const child of node) countType(child, target, out);
    return out;
  }
  if (typeof node !== 'object') return out;
  if (node.type === target) out.n += 1;
  for (const child of node.children ?? []) countType(child, target, out);
  return out;
}

/** Load a fresh copy of the bundle and return its exports. */
async function loadBundle(fakeReact) {
  captured = null;
  await import(`../lib/client.js?run=${Math.random()}`);
  if (captured === null) throw new Error('bundle 没有注册到 __ModuleLoader__');
  return captured.factory((id) => {
    if (id === 'react') return fakeReact;
    throw new Error(`unexpected require('${id}')`);
  });
}

/**
 * Build a fake client ctx whose `slots` service records every registration.
 * `declared` controls whether `inject` fires its callback — that is exactly the
 * "the owning shell has declared the seat" gate.
 */
function makeCtx(declared = true) {
  const registrations = [];
  const effects = [];
  const ctx = {
    effect(callback) {
      const disposer = callback();
      effects.push(disposer);
      return () => typeof disposer === 'function' && disposer();
    },
    slots: {
      inject(name, callback) {
        if (declared) callback();
        return () => {};
      },
      register(options, component) {
        registrations.push({ options, component });
        return () => {};
      },
    },
  };
  return { ctx, registrations, effects };
}

// ---- 1. evaluate + exports ------------------------------------------------

const react = makeReact();
const exports_ = await loadBundle(react);

check('client bundle 通过 __ModuleLoader__ 注册了自己', captured?.id === 'dsh-skill-cockpit', captured?.id);
check('factory 返回 apply 函数', typeof exports_?.apply === 'function');
check(
  'factory 声明 inject: ["slots"]（官方扩展点，不再依赖 betterSidebar）',
  Array.isArray(exports_.inject) && exports_.inject.length === 1 && exports_.inject[0] === 'slots',
  JSON.stringify(exports_.inject),
);

// ---- 2. apply() → the global-panel mount pair ------------------------------

const run = makeCtx(true);
exports_.apply(run.ctx);
const row = run.registrations.find((r) => r.options.name === 'sidebar.panellist');
const page = run.registrations.find((r) => r.options.name === 'main');

check('apply 用 ctx.effect 注册（可回收）', run.effects.length === 1);
check('注册了 2 个座位（左排 nav 行 + 主区整页）', run.registrations.length === 2, String(run.registrations.length));
check('nav 行落在 sidebar.panellist（应用级导航 list 座位）', Boolean(row), row?.options.name);
check('nav 行 id = skill-panel', row?.options.id === 'skill-panel', row?.options.id);
check(
  'nav 行 order = 5，严格夹在「插件」(0) 与「自动化任务」(10) 之间',
  row?.options.order === 5 && row.options.order > 0 && row.options.order < 10,
  String(row?.options.order),
);
check('nav 行 label = 技能（侧栏按钮文字由外壳从这里取）', row?.options.label === '技能', row?.options.label);
check(
  '主区整页注册进 main keyed 座位，key 与 nav 行 id 一致（否则点击抛错）',
  page?.options.key === row?.options.id,
  page?.options.key,
);
check('nav 行组件是函数（图标只有外壳给的 size/active）', typeof row?.component === 'function');
check('主区组件是函数', typeof page?.component === 'function');

// declaration-aware: a shell that never declares the seat must not break apply
const undeclared = makeCtx(false);
let undeclaredThrew = false;
try {
  exports_.apply(undeclared.ctx);
} catch {
  undeclaredThrew = true;
}
check(
  '座位未声明时不注册也不抛错（declaration-aware，走 slots.inject 闸门）',
  undeclaredThrew === false && undeclared.registrations.length === 0,
  `${undeclared.registrations.length} 个注册`,
);

// ---- fixture --------------------------------------------------------------

const fixture = {
  generatedAt: '2026-10-07T00:00:00.000Z',
  cwd: 'D:\\工作区\\插件制作',
  projectRoot: 'D:\\工作区\\插件制作',
  includeDefaultRoots: true,
  roots: [
    { source: 'project-dsh', rank: 100, path: 'D:\\工作区\\插件制作\\.dsh\\skills', exists: false, writable: false, configured: true, skillCount: 0, enabledCount: 0, disabledCount: 0 },
    { source: 'user-dsh', rank: 400, path: 'C:\\Users\\x\\.dsh\\skills', exists: true, writable: true, configured: true, skillCount: 2, enabledCount: 1, disabledCount: 1 },
    { source: 'bundled', rank: 600, path: null, exists: false, writable: false, configured: false, skillCount: 0, enabledCount: 0, disabledCount: 0, note: '$DSH_BUNDLED_SKILL_DIR 未设置' },
  ],
  skills: [
    {
      name: 'canvas-design',
      description: '生成 PNG/PDF 视觉稿',
      source: 'user-dsh',
      rank: 400,
      form: 'dir-bundle',
      enabled: true,
      status: 'ok',
      bytes: 1629,
      filePath: 'C:\\Users\\x\\.dsh\\skills\\canvas-design\\SKILL.md',
      writable: true,
    },
    {
      name: 'broken-one',
      description: '',
      source: 'user-dsh',
      rank: 400,
      form: 'flat-md',
      enabled: false,
      status: 'dropped:no-frontmatter',
      reason: '首行不是 --- （模型看不到这个技能）',
      bytes: 42,
      filePath: 'C:\\Users\\x\\.dsh\\skills\\broken-one.md.disabled',
      writable: true,
    },
  ],
  summary: {
    rootsConfigured: 5,
    rootsMounted: 5,
    rootsPresent: 2,
    totalEntries: 2,
    enabled: 1,
    disabled: 1,
    ok: 1,
    dropped: 1,
    errors: 0,
    visibleToModel: 1,
    shadowed: 0,
  },
  environment: { DSH_HOME: 'C:\\Users\\x\\.dsh', DSH_BUNDLED_SKILL_DIR: null },
};

/** The framework's `main`-seat standard prop shape we read cwd out of. */
const useSessionsStub = (selector) =>
  selector({ current: 's1', byId: { s1: { cwd: fixture.cwd } } });

/** Apply the bundle to a fresh fake ctx and hand back the page component. */
async function pageFor(presetBoxes, props = { useSessions: useSessionsStub }) {
  const fakeReact = makeReact();
  const exportsX = await loadBundle(fakeReact);
  Object.assign(fakeReact.boxes, presetBoxes);
  const runX = makeCtx(true);
  exportsX.apply(runX.ctx);
  const pageX = runX.registrations.find((r) => r.options.name === 'main');
  return { tree: expand(pageX.component(props)), text: null, component: pageX.component };
}

async function renderText(presetBoxes, props) {
  const { tree } = await pageFor(presetBoxes, props);
  return { tree, text: collectText(tree).join('\n') };
}

// ---- 3a. render a healthy + dropped scan ---------------------------------

const a = await renderText({ 0: fixture, 1: null, 2: false, 3: 'all', 4: '', 5: null, 6: null });
const textA = a.text;

check('渲染成功且含汇总行', textA.includes('共 2 条') && textA.includes('模型实际可见 1'), textA.split('\n').find((l) => l.includes('共 2 条')));
check('渲染出正常技能名与描述', textA.includes('canvas-design') && textA.includes('生成 PNG/PDF 视觉稿'));
check('渲染出坏 frontmatter 的红字原因', textA.includes('缺 frontmatter') && textA.includes('模型看不到它'));
check('渲染出「已停用」标记', textA.includes('已停用'));
check('渲染出当前会话的项目根', textA.includes('项目根（当前会话）') && textA.includes('项目根'));
check('cwd 取自 useSessions 快照的 current → byId.cwd（新座位无 scope prop）', textA.includes(fixture.cwd));
check('渲染出根清单（含未挂载根与只读标记）', textA.includes('user-dsh #400') && textA.includes('未挂载'));
check('渲染出「唯一会写盘的动作」说明', textA.includes('只改入口文件名'));
check('写明「开关即写盘」（一步切换的说明）', textA.includes('开关即写盘'));
check('渲染出可交互按钮（刷新/筛选/看正文）', countType(a.tree, 'button').n >= 5, String(countType(a.tree, 'button').n));

// ---- 3a'. the no-useSessions fallback (no session binding on this seat) ----

const aFallback = await renderText({ 0: fixture, 1: null, 2: false, 3: 'all', 4: '', 5: null, 6: null }, {});
check(
  '外壳不给 useSessions 时降级为「只列用户级」而不是崩溃',
  aFallback.text.includes('项目根：无 —— 本页是全局页，不绑定会话') && aFallback.text.includes('共 2 条'),
);

// ---- 3b. render the undeclared-index hit ----------------------------------

const hitsFixture = {
  configured: true,
  exists: true,
  path: 'D:\\管家\\技能索引与最小路由\\技能改造\\未安装技能索引-正文.md',
  query: 'office',
  total: 1,
  truncated: false,
  hits: [{ kind: 'table', header: ['名字', '能力'], cells: ['office-docx', 'Word 处理'], line: 42 }],
};
const b = await renderText({ 0: fixture, 1: null, 2: false, 3: 'all', 4: 'office', 5: null, 6: hitsFixture });
const textB = b.text;
check('第二跳命中时渲染信息卡', textB.includes('office-docx') && textB.includes('Word 处理'));
check('信息卡标注只读不安装', textB.includes('只读 · 不安装'));
check('信息卡带复制按钮', textB.includes('复制'));

// ---- 3c. the switch is a real, clickable control (one-click flow) ----------
//
// 0.2.0 rendered a confirmation bar; the owner asked for one click (2026-10-08),
// so the switch itself must be live and carry a stable hook for the click test.

const c = await renderText({ 0: fixture, 1: null, 2: false, 3: 'all', 4: '', 5: null, 6: null });
check('渲染出可点的开关，带稳定 data 钩子', firstByProp(c.tree, 'data-dsh-skill-toggle') !== null);
check(
  '可写根上的启用技能：开关不是禁用态',
  firstByProp(c.tree, 'data-dsh-skill-toggle')?.props?.disabled === false,
  String(firstByProp(c.tree, 'data-dsh-skill-toggle')?.props?.disabled),
);
check('一遍过：不再出现确认条', !c.text.includes('确认改名'));
check('说明写明这是唯一写盘动作', c.text.includes('唯一会写盘的动作'));

// ---- 3d. render the error branch ------------------------------------------

const d = await renderText({ 0: null, 1: 'HTTP 500', 2: false, 3: 'all', 4: '', 5: null, 6: null });
check('错误状态显式显示（不装死）', d.text.includes('✗') && d.text.includes('HTTP 500'));

// ---- 3e. the WIRE PAYLOAD of the only write action ------------------------
//
// Regression guard for the 2026-10-08 bug: the switch shows the CURRENT state,
// so the request must carry the OPPOSITE intent. The shipped build sent
// `disable: !enabled`, i.e. it asked the host to ENABLE an enabled skill; the
// host answered 400 ("该技能当前不是 .disabled，无需恢复") and every click looked
// inert. Asserting rendered text can never catch that — only the outgoing body.

/** Find the first element carrying `prop` (and, when given, that exact value). */
function firstByProp(node, prop, value) {
  if (node === null || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = firstByProp(child, prop, value);
      if (found) return found;
    }
    return null;
  }
  if (node.props && node.props[prop] !== undefined && (value === undefined || node.props[prop] === value)) {
    return node;
  }
  for (const child of node.children ?? []) {
    const found = firstByProp(child, prop, value);
    if (found) return found;
  }
  return null;
}

/** Render the panel and click the row's switch, capturing the outgoing /toggle request. */
async function captureToggle(skill, report = fixture) {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return { ok: true, status: 200, json: async () => ({ applied: true, ok: true }) };
  };
  try {
    const fakeReact = makeReact();
    const exportsX = await loadBundle(fakeReact);
    Object.assign(fakeReact.boxes, { 0: report, 1: null, 2: false, 3: 'all', 4: '', 5: null, 6: null });
    const runX = makeCtx(true);
    exportsX.apply(runX.ctx);
    const pageX = runX.registrations.find((r) => r.options.name === 'main');
    const tree = expand(pageX.component({ useSessions: useSessionsStub }));
    // Click THAT skill's switch, not merely the first one on the page.
    const sw = firstByProp(tree, 'data-dsh-skill-toggle', skill.filePath);
    if (!sw) return { switchMissing: true };
    await sw.props.onClick();
    const seen = calls.find((c) => c.url.endsWith('/toggle'));
    return { method: seen?.init?.method, body: seen ? JSON.parse(seen.init.body) : null };
  } finally {
    globalThis.fetch = realFetch;
  }
}

const onCase = await captureToggle(fixture.skills[0]); // canvas-design · enabled: true
check(
  '点开关即对 /toggle 发 POST（写动作走真实 HTTP，不是改本地状态）',
  onCase.method === 'POST' && !onCase.switchMissing,
  String(onCase.method),
);
check(
  '⚡ 开关为「开」时载荷必须是 disable:true（曾写反 ⇒ 主机 400，点了像没反应）',
  onCase.body?.disable === true,
  JSON.stringify(onCase.body),
);
check(
  '载荷带上被点那条技能的真实路径',
  onCase.body?.filePath === fixture.skills[0].filePath,
  String(onCase.body?.filePath),
);

// A clean, writable skill that is currently OFF — the "restore" direction.
const offSkill = {
  ...fixture.skills[0],
  enabled: false,
  enabledName: 'SKILL.md.disabled',
  filePath: 'C:\\Users\\x\\.dsh\\skills\\canvas-design\\SKILL.md.disabled',
};
const offCase = await captureToggle(offSkill, { ...fixture, skills: [offSkill] });
check(
  '⚡ 开关为「关」时载荷必须是 disable:false（恢复方向同样不能写反）',
  offCase.body?.disable === false,
  JSON.stringify(offCase.body),
);

// ---- 3f. 0.3.0 · the three views -----------------------------------------
//
// The mock React returns `[initial, noop]` for every useState, so a view is
// selected by presetting its slot: 7 = view, 8 = usage, 10 = checks.

const clientSource = readFileSync(join(import.meta.dirname, '..', 'lib', 'client.js'), 'utf8');
/** Code only: comments may legitimately NAME the dead 0.2.x tokens. */
const clientCode = clientSource
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n');
const pkgVersion = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'),
).version;

// ---- 3g. 0.4.0 · 界面重构的结构性断言 -------------------------------------
// 只增不减：锁住 0.4.0 的视觉决定，防止后续改动悄悄退回"每行一个描边卡片"，
// 也防止重新引入宿主里根本不存在的令牌（它们的 var() 会静默吃 fallback）。

check(
  '0.4.0：列表是一张分组卡 + 行间发丝线（不再每行一个描边盒子）',
  clientCode.includes("className: 'cockpit-card'") &&
    /\.cockpit-row\+\.cockpit-row\{border-top:\.5px solid/.test(clientCode),
  'cockpit-card + .cockpit-row+.cockpit-row hairline',
);
check(
  '0.4.0：等宽字号用 --ds-font-family-code（--dsw-font-mono 在宿主里定义 0 次）',
  clientCode.includes('--ds-font-family-code') && !clientCode.includes('--dsw-font-mono'),
  '',
);
check(
  '0.4.0：警告色用 --dsw-alias-state-warn-primary（…-warning-primary 定义 0 次）',
  clientCode.includes('--dsw-alias-state-warn-primary') &&
    !clientCode.includes('--dsw-alias-state-warning-primary'),
  '',
);
check(
  '0.4.0：无障碍两条已就位（focus-visible 焦点环 + prefers-reduced-motion）',
  clientCode.includes('--dsw-focus-ring-width') && clientCode.includes('prefers-reduced-motion'),
  '',
);
check(
  '0.4.0：原始入口路径只在展开时渲染，列表里不再每行显示',
  clientSource.includes("open ? h('div', { className: 'cockpit-path' }") &&
    !clientCode.includes("style: { color: C.dim, fontSize: '11px', marginTop: '4px', wordBreak: 'break-all' }"),
  '',
);

const listView = await renderText({ 0: fixture, 1: null, 2: false, 3: 'all', 4: '', 5: null, 6: null });
check(
  '视图切换：列表 / 用量 / 问题 三个按钮都在，并带 data-dsh-view 钩子',
  ['list', 'usage', 'checks'].every((key) => firstByProp(listView.tree, 'data-dsh-view', key) !== null),
);

const usageFixture = {
  ok: true,
  skills: [{ name: 'canvas-design', count: 3, lastAt: 1_700_000_000_000 }],
  scanned: 2,
  skipped: 5,
  sessions: 12,
  updatedAt: 1_700_000_100_000,
  storePath: 'C:\\Users\\x\\.dsh\\dsh-skill-cockpit\\usage.json',
  privacy: '只存技能名 / 调用次数 / 时间戳，不存任何对话内容',
};
const usageView = await renderText({ 0: fixture, 1: null, 2: false, 3: 'all', 4: '', 5: null, 6: null, 7: 'usage', 8: usageFixture });
check(
  '用量视图：列出技能名、次数与最后调用时间',
  usageView.text.includes('canvas-design') && usageView.text.includes('3 次') && usageView.text.includes('最后调用'),
  usageView.text.split('\n').find((line) => line.includes('canvas-design')),
);
check(
  '用量视图：顶部说明扫描口径（扫描 / 跳过 / 会话数）',
  usageView.text.includes('扫描 2 个会话日志') && usageView.text.includes('跳过 5 个') && usageView.text.includes('12 个会话'),
);
check('用量视图：明说不存对话内容', usageView.text.includes('不存任何对话内容'));
check('用量视图：不渲染列表的筛选框（视图互斥）', !usageView.text.includes('筛选已装技能'));

const usageEmpty = { ...usageFixture, skills: [] };
const emptyView = await renderText({ 0: fixture, 1: null, 2: false, 3: 'all', 4: '', 5: null, 6: null, 7: 'usage', 8: usageEmpty });
check(
  '⚡ 用量为 0 时的空态逐字给出「装了 N 个技能，但最近 M 个会话一次都没被调用过」',
  emptyView.text.includes('装了 1 个技能，但最近 12 个会话一次都没被调用过'),
  emptyView.text.split('\n').find((line) => line.includes('一次都没被调用过')),
);

const checksFixture = {
  ok: true,
  checks: [
    { kind: 'short-description', skill: 'broken-one', detail: '描述为空（实际长度 0 字，阈值 20 字）' },
    { kind: 'empty-body', skill: 'tiny-skill', detail: '文件只有 120 字节，少于 300 字节阈值（按文件字节估计，含 frontmatter，不是精确正文长度）' },
  ],
  summary: {
    total: 2,
    shadowed: 0,
    shortDescription: 1,
    dirNameMismatch: 0,
    emptyBody: 1,
    byKind: { shadowed: 0, 'short-description': 1, 'dir-name-mismatch': 0, 'empty-body': 1 },
    scanned: 2,
  },
  thresholds: { minDescriptionLength: 20, emptyBodyBytes: 300 },
  note: '正文长度按文件字节估计（启发式，不是精确正文长度）',
  scannedSkills: 2,
};
const checksView = await renderText({ 0: fixture, 1: null, 2: false, 3: 'all', 4: '', 5: null, 6: null, 7: 'checks', 10: checksFixture });
check(
  '问题视图：四类中文标签都在，并带各自计数',
  ['跨根重名被遮蔽', '描述为空或过短', '目录名≠技能名', '正文疑似为空'].every((label) => checksView.text.includes(label)),
  checksView.text.split('\n').slice(0, 8).join(' | '),
);
check(
  '问题视图：渲染真实命中（技能名 + detail）',
  checksView.text.includes('broken-one') && checksView.text.includes('描述为空（实际长度 0 字'),
);
check(
  '问题视图：原样显示「按文件字节估计」（启发式，不假装精确）',
  checksView.text.includes('按文件字节估计'),
);
check(
  '问题视图：固定说明为什么有些技能禁不了（registerProvider 只允许追加）',
  checksView.text.includes('registerProvider') && checksView.text.includes('没有排除别人输出的钩子'),
);

const checksEmptyView = await renderText({
  0: fixture, 1: null, 2: false, 3: 'all', 4: '', 5: null, 6: null, 7: 'checks',
  10: { ...checksFixture, checks: [] },
});
check('问题视图：没有问题时显示「没有发现问题」', checksEmptyView.text.includes('没有发现问题'));

// ---- 3g. a provider-supplied skill gets an honest label, not a dead switch --

const providerSkill = {
  name: 'mcp-tool-skill',
  description: '由 MCP provider 提供的技能（没有入口文件）',
  source: 'provider',
  provider: 'mcp',
  rank: 0,
  form: 'provider',
  enabled: true,
  status: 'ok',
  bytes: 0,
  filePath: 'mcp://tool-skill',
  writable: false,
};
const providerReport = {
  ...fixture,
  skills: [...fixture.skills, providerSkill],
  summary: { ...fixture.summary, totalEntries: 3, enabled: 2, visibleToModel: 2 },
};
const providerView = await renderText({
  0: providerReport, 1: null, 2: false, 3: 'all', 4: '', 5: null, 6: null,
});
check(
  '非文件型技能：开关位置显示「本面板无法禁用（属 X provider）」',
  providerView.text.includes('本面板无法禁用（属 mcp provider）'),
  providerView.text.split('\n').find((line) => line.includes('本面板无法禁用')),
);
check(
  '非文件型技能：带 data-dsh-skill-nofile 钩子，且没有假开关',
  firstByProp(providerView.tree, 'data-dsh-skill-nofile', 'mcp-tool-skill') !== null &&
    firstByProp(providerView.tree, 'data-dsh-skill-toggle', 'mcp://tool-skill') === null,
);
check(
  '文件型技能照旧有开关（不给真技能误标成「禁不了」）',
  firstByProp(providerView.tree, 'data-dsh-skill-toggle', fixture.skills[0].filePath) !== null,
);

// ---- 3h. theme discipline + version --------------------------------------

check(
  '⚡ 代码里不再出现 --dsw-color-（宿主里那 9 个令牌根本不存在）',
  !clientCode.includes('--dsw-color-'),
);
check(
  '每个 var(--dsw-*) 都带 fallback（正则扫 var(...) 无第二参数即失败）',
  !/var\(\s*--[a-zA-Z0-9-]+\s*\)/.test(clientCode),
  (clientCode.match(/var\(\s*--[a-zA-Z0-9-]+\s*\)/g) ?? []).join(' '),
);
check(
  '主题接的是宿主真实的 --dsw-alias-*（边框用 -l2，不用只有 4% 黑的 -l1）',
  clientCode.includes('--dsw-alias-label-primary') &&
    clientCode.includes('--dsw-alias-border-l2') &&
    !clientCode.includes('--dsw-alias-border-l1'),
);
check(
  '页脚显示面板版本，且与 package.json 一致',
  listView.text.includes(`面板版本 v${pkgVersion}`),
  pkgVersion,
)

check(
  '整组开/停按当前状态筛目标（enabled === disable），不会永远空集',
  clientCode.includes('Boolean(s.enabled) === Boolean(disable)') &&
    !clientCode.includes('s.enabled === !disable'),
);
// ── i18n（0.6.8）：字典本身的完整性 + 用到的 key 必须存在 ──
const messagesStart = clientCode.indexOf('const MESSAGES = {');
const messagesText = (function sliceBalanced(text, from) {
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(from, i + 1);
    }
  }
  return '';
})(clientCode, clientCode.indexOf('{', messagesStart));
const MESSAGES = messagesStart >= 0 ? new Function(`return ${messagesText}`)() : null;

check(
  'i18n 字典可解析出 zh / en 两套',
  Boolean(MESSAGES && MESSAGES.zh && MESSAGES.en),
);
const zhKeys = MESSAGES ? Object.keys(MESSAGES.zh).sort() : [];
const enKeys = MESSAGES ? Object.keys(MESSAGES.en).sort() : [];
check(
  'zh / en key 集合完全一致（不漏译）',
  zhKeys.length > 0 && zhKeys.join('|') === enKeys.join('|'),
  `${zhKeys.length} keys`,
);
check(
  'en 字典里没有残留中文（逐条校验，不做模糊匹配）',
  Boolean(MESSAGES) && enKeys.every((k) => !/[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/.test(MESSAGES.en[k])),
);
const usedKeys = [...clientCode.matchAll(/\bt\('([^']+)'/g)].map((m) => m[1]);
check(
  '代码里 t(...) 用到的每个 key 都在字典里（防手误）',
  usedKeys.length > 0 && [...new Set(usedKeys)].every((k) => zhKeys.includes(k)),
  `${new Set(usedKeys).size} 个 key 在用`,
);
check(
  '接的是宿主 locale 服务，且用 ctx.get 方式（不给宿主加硬 inject 依赖）',
  clientCode.includes('ctx.get(') &&
    clientCode.includes("get('locale')") &&
    clientCode.includes('localeService.register(LOCALE_NS, MESSAGES)') &&
    clientCode.includes('localeService.bind(LOCALE_NS)'),
);

// ── 语言真的跟随宿主：塞一个假 locale 服务，文案必须变成它给的值 ──
{
  const fresh = await loadBundle(react);
  const seenRegistrations = [];
  let boundNs = null;
  const shell = makeCtx(true);
  shell.ctx.get = (name) =>
    name === 'locale'
      ? {
          register(ns, dictionaries) {
            seenRegistrations.push({ ns, dictionaries });
            return () => {};
          },
          bind(ns) {
            boundNs = ns;
            return (key) => `EN:${key}`;
          },
        }
      : undefined;
  fresh.apply(shell.ctx);
  const navRow = shell.registrations.filter((r) => r.options && r.options.name === 'sidebar.panellist')[0];
  check(
    '宿主给了 locale 服务：字典按命名空间注册，且 nav 行文案改由宿主的翻译函数提供',
    boundNs === 'skill-cockpit' &&
      seenRegistrations.length === 1 &&
      seenRegistrations[0].ns === 'skill-cockpit' &&
      Boolean(seenRegistrations[0].dictionaries && seenRegistrations[0].dictionaries.zh && seenRegistrations[0].dictionaries.en) &&
      Boolean(navRow) &&
      navRow.options.label === 'EN:nav.label',
    JSON.stringify({ boundNs, label: navRow && navRow.options.label }),
  );
};


const runAgain = makeCtx(true);
const exportsAgain = await loadBundle(makeReact());
exportsAgain.apply(runAgain.ctx);
const rowAgain = runAgain.registrations.find((r) => r.options.name === 'sidebar.panellist');
const pageAgain = runAgain.registrations.find((r) => r.options.name === 'main');
check(
  '两次加载的注册一致（无隐藏状态）',
  rowAgain?.options.id === row?.options.id &&
    rowAgain?.options.order === row?.options.order &&
    pageAgain?.options.key === page?.options.key,
);

mkdirSync(reportDir, { recursive: true });
writeFileSync(
  join(reportDir, 'client-report.json'),
  JSON.stringify(
    {
      mount: {
        row: row ? { slot: row.options.name, id: row.options.id, order: row.options.order, label: row.options.label } : null,
        page: page ? { slot: page.options.name, key: page.options.key } : null,
      },
      exportsInject: exports_.inject,
      checks,
      renderedTextSample: textA.split('\n').slice(0, 30),
    },
    null,
    2,
  ),
);
console.log(`\n报告已写：${join(reportDir, 'client-report.json')}`);

const failed = checks.filter((c2) => !c2.ok);
console.log(`\n=== 客户端自测：${checks.length - failed.length}/${checks.length} 通过 ===`);
process.exit(failed.length === 0 ? 0 : 1);
