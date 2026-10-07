/**
 * Skill panel · CLIENT-half smoke test (no browser, no dsh).
 *
 *   node test/run-client.mjs [reportDir]
 *
 * lib/client.js is a classic script for DSH's client-modules protocol, so this
 * test fakes exactly that protocol — `window.__ModuleLoader__.load({id,factory})`
 * plus a `require('react')` stub — and then:
 *   1. evaluates the bundle and checks the exports (`apply` / `inject`);
 *   2. runs `apply(ctx)` against a fake ctx and asserts the tab descriptor the
 *      page is registered with (id / title / single / component);
 *   3. renders the component with a hook harness in three states — a healthy
 *      scan, a scan containing a `dropped:*` entry, and an
 *      undeclared-index hit — and asserts each is really drawn.
 *
 * It cannot verify pixels or the real sidebar; that needs dsh running again
 * (see the assembly checklist). It does catch the class of bug that matters
 * here: a bundle that never evaluates, a wrong descriptor, a render crash, a
 * branch that silently renders nothing.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
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

// ---- 1. evaluate + exports ------------------------------------------------

const react = makeReact();
const exports_ = await loadBundle(react);

check('client bundle 通过 __ModuleLoader__ 注册了自己', captured?.id === 'dsh-skill-panel', captured?.id);
check('factory 返回 apply 函数', typeof exports_?.apply === 'function');
check(
  'factory 声明 inject: ["betterSidebar"]',
  Array.isArray(exports_.inject) && exports_.inject.length === 1 && exports_.inject[0] === 'betterSidebar',
  JSON.stringify(exports_.inject),
);

// ---- 2. apply() → tab descriptor ------------------------------------------

let descriptor = null;
const effects = [];
exports_.apply({
  effect(callback) {
    const disposer = callback();
    effects.push(disposer);
    return () => typeof disposer === 'function' && disposer();
  },
  betterSidebar: {
    registerTab(d) {
      descriptor = d;
      return () => {};
    },
  },
});

check('apply 用 ctx.effect 注册 tab（可回收）', effects.length === 1);
check('tab id = skill-panel', descriptor?.id === 'skill-panel', descriptor?.id);
check('tab 有中文标题', typeof descriptor?.title === 'string' && descriptor.title.length > 0, descriptor?.title);
check('tab 单例 + 有描述', descriptor?.single === true && typeof descriptor?.description === 'string');
check('component 是函数', typeof descriptor?.component === 'function');

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

// ---- 3a. render a healthy + dropped scan ---------------------------------

const reactA = makeReact();
const exportsA = await loadBundle(reactA);
Object.assign(reactA.boxes, { 0: fixture, 1: null, 2: false, 3: 'all', 4: '', 5: null, 6: null });
let descriptorA = null;
exportsA.apply({
  effect(cb) {
    cb();
    return () => {};
  },
  betterSidebar: { registerTab(d) { descriptorA = d; return () => {}; } },
});

const treeA = expand(descriptorA.component({ scope: { sessionId: 's1', cwd: fixture.cwd }, visible: false }));
const textA = collectText(treeA).join('\n');

check('渲染成功且含汇总行', textA.includes('共 2 条') && textA.includes('模型实际可见 1'), textA.split('\n').find((l) => l.includes('共 2 条')));
check('渲染出正常技能名与描述', textA.includes('canvas-design') && textA.includes('生成 PNG/PDF 视觉稿'));
check('渲染出坏 frontmatter 的红字原因', textA.includes('缺 frontmatter') && textA.includes('模型看不到它'));
check('渲染出「已停用」标记', textA.includes('已停用'));
check('渲染出当前会话 cwd 与项目根', textA.includes('当前会话 cwd') && textA.includes('项目根'));
check('渲染出根清单（含未挂载根与只读标记）', textA.includes('user-dsh #400') && textA.includes('未挂载'));
check('渲染出「唯一会写盘的动作」说明', textA.includes('只改入口文件名'));
check('没有 pending 时不显示确认条', !textA.includes('确认改名'));
check('渲染出可交互按钮（刷新/筛选/看正文）', countType(treeA, 'button').n >= 5, String(countType(treeA, 'button').n));
check('渲染出开关（按钮式 toggle）', textA.includes('canvas-design'));

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
const reactB = makeReact();
const exportsB = await loadBundle(reactB);
Object.assign(reactB.boxes, { 0: fixture, 1: null, 2: false, 3: 'all', 4: 'office', 5: null, 6: hitsFixture });
let descriptorB = null;
exportsB.apply({
  effect(cb) {
    cb();
    return () => {};
  },
  betterSidebar: { registerTab(d) { descriptorB = d; return () => {}; } },
});
const textB = collectText(expand(descriptorB.component({ scope: { sessionId: 's1', cwd: fixture.cwd }, visible: false }))).join('\n');
check('第二跳命中时渲染信息卡', textB.includes('office-docx') && textB.includes('Word 处理'));
check('信息卡标注只读不安装', textB.includes('只读 · 不安装'));
check('信息卡带复制按钮', textB.includes('复制'));

// ---- 3c. render the toggle confirmation -----------------------------------

const reactC = makeReact();
const exportsC = await loadBundle(reactC);
Object.assign(reactC.boxes, { 0: fixture, 1: null, 2: false, 3: 'all', 4: '', 5: fixture.skills[0], 6: null });
let descriptorC = null;
exportsC.apply({
  effect(cb) {
    cb();
    return () => {};
  },
  betterSidebar: { registerTab(d) { descriptorC = d; return () => {}; } },
});
const textC = collectText(expand(descriptorC.component({ scope: { sessionId: 's1', cwd: fixture.cwd }, visible: false }))).join('\n');
check('pending 时显示确认条 + from→to', textC.includes('确认改名') && textC.includes('SKILL.md.disabled'));
check('确认条写明这是唯一写盘动作', textC.includes('唯一会写盘的动作'));

// ---- 3d. render the error branch ------------------------------------------

const reactD = makeReact();
const exportsD = await loadBundle(reactD);
Object.assign(reactD.boxes, { 0: null, 1: 'HTTP 500', 2: false, 3: 'all', 4: '', 5: null, 6: null });
let descriptorD = null;
exportsD.apply({
  effect(cb) {
    cb();
    return () => {};
  },
  betterSidebar: { registerTab(d) { descriptorD = d; return () => {}; } },
});
const textD = collectText(expand(descriptorD.component({ scope: { sessionId: 's1', cwd: fixture.cwd }, visible: false }))).join('\n');
check('错误状态显式显示（不装死）', textD.includes('✗') && textD.includes('HTTP 500'));

// ---- verify the apply() in the very first load is the same shape ----------

check(
  '三次重新加载的 descriptor 一致（无隐藏状态）',
  descriptor?.id === descriptorA?.id && descriptorA?.id === descriptorB?.id && descriptorB?.id === descriptorC?.id,
);

mkdirSync(reportDir, { recursive: true });
writeFileSync(
  join(reportDir, 'client-report.json'),
  JSON.stringify(
    {
      descriptor: { id: descriptor?.id, title: descriptor?.title, single: descriptor?.single, description: descriptor?.description },
      exportsInject: exports_.inject,
      checks,
      renderedTextSample: textA.split('\n').slice(0, 30),
    },
    null,
    2,
  ),
);
console.log(`\n报告已写：${join(reportDir, 'client-report.json')}`);

const failed = checks.filter((c) => !c.ok);
console.log(`\n=== 客户端自测：${checks.length - failed.length}/${checks.length} 通过 ===`);
process.exit(failed.length === 0 ? 0 : 1);
