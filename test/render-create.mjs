/**
 * 渲染冒烟：把 client 半在 Node 里真跑一遍（迷你 React），
 * 然后点「新建技能」，确认能渲染出创建表单（data-dsh-manage="create"）。
 *
 * 为什么要有这条测试：只做字符串/字典断言抓不到「渲染期 ReferenceError」——
 * 那种错会让整页白屏，而单元测试全绿（2026-10-27 实犯：ManageBox 用了
 * SkillPanel 里才定义的 TPL_LABEL，一点新建技能整页白）。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

let current = null
const hookStore = new Map()

const React = {
  createElement(type, props, ...children) {
    const merged = { ...(props || {}) }
    const kids = children.filter((child) => child !== undefined)
    if (kids.length === 1) merged.children = kids[0]
    else if (kids.length > 1) merged.children = kids
    return { type, props: merged }
  },
  useState(initial) {
    const store = current.store
    const index = current.index++
    if (!(index in store)) store[index] = typeof initial === 'function' ? initial() : initial
    const set = (next) => {
      store[index] = typeof next === 'function' ? next(store[index]) : next
      schedule()
    }
    return [store[index], set]
  },
  useEffect() {},
  useCallback(fn) {
    return fn
  },
  useMemo(fn) {
    return fn()
  },
}

let rerenderRequested = false
let rerenderRoot = null
const schedule = () => {
  rerenderRequested = true
}

/** 迷你渲染：函数组件按「路径 + 组件名」存 hook 槽位，宿主元素原样保留。 */
function renderNode(node, path) {
  if (node === null || node === undefined || node === false) return null
  if (typeof node === 'string' || typeof node === 'number') return node
  if (Array.isArray(node)) return node.map((child, index) => renderNode(child, `${path}.${index}`))
  if (typeof node !== 'object' || !node.type) return null

  if (typeof node.type === 'function') {
    const name = node.type.name || 'anon'
    const key = `${path}>${name}`
    if (!hookStore.has(key)) hookStore.set(key, [])
    const previous = current
    current = { store: hookStore.get(key), index: 0 }
    let output
    try {
      output = node.type(node.props || {})
    } finally {
      current = previous
    }
    return renderNode(output, key)
  }
  const { children, ...rest } = node.props || {}
  return { type: node.type, props: rest, children: renderNode(children, `${path}/<${node.type}>`) }
}

function renderRoot(component, props) {
  rerenderRoot = () => renderRoot(component, props)
  rerenderRequested = false
  return renderNode(React.createElement(component, props), 'root')
}

function collect(node, out = []) {
  if (Array.isArray(node)) {
    for (const child of node) collect(child, out)
    return out
  }
  if (node && typeof node === 'object' && node.type) {
    out.push(node)
    collect(node.children, out)
  }
  return out
}

function textOf(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node && typeof node === 'object' && node.type) return textOf(node.children)
  return ''
}

// ── 假的宿主环境 ───────────────────────────────────────────────
const store = new Map()
const fakeWindow = {
  __ModuleLoader__: {
    load(definition) {
      const exported = definition.factory((name) => {
        if (name === 'react') return React
        throw new Error(`未预料的 require: ${name}`)
      })
      fakeWindow.__exports = exported
    },
  },
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  },
}

let registered = null
const ctx = {
  get: () => null,
  effect: () => {},
  slots: {
    inject: (_name, callback) => {
      callback()
      return () => {}
    },
    register: (options, component) => {
      if (options && options.name === 'main') registered = component
      return () => {}
    },
  },
}

const globals = {
  window: fakeWindow,
  localStorage: fakeWindow.localStorage,
  navigator: { clipboard: null },
  fetch: () => Promise.reject(new Error('渲染期不应发请求')),
  console: { log() {}, warn() {}, error() {} },
}

const run = new Function(...Object.keys(globals), source)
run(...Object.values(globals))

const plugin = fakeWindow.__exports
if (!plugin || typeof plugin.apply !== 'function') throw new Error('client 半没有导出 apply()')
plugin.apply(ctx)
if (typeof registered !== 'function') throw new Error('没有注册 main 槽位的页面组件')

// 1) 首屏能渲染
renderRoot(registered, {})
const first = collect(renderRoot(registered, {}))
const buttons = first.filter((node) => node.type === 'button')
const createButton = buttons.find((node) => textOf(node).includes('新建技能'))
if (!createButton) throw new Error('首屏找不到「新建技能」按钮')
if (typeof createButton.props.onClick !== 'function') throw new Error('「新建技能」按钮没有 onClick')

// 1.5) 工具栏的「一键翻译」必须是中文（2026-10-27 实犯：zh 字典漏了 gloss.* 五个键，
//      宿主 locale 回落到英文，按钮显示成「Translate」）
const translateButton = buttons.find((node) => textOf(node).includes('翻译'))
if (!translateButton) throw new Error('首屏找不到「翻译」按钮（zh 字典可能漏了 gloss.translate）')
if (buttons.some((node) => textOf(node).trim() === 'Translate')) {
  throw new Error('工具栏还残留英文「Translate」按钮（zh 词条没生效）')
}

// 2) 点它 → 应当渲染出创建表单，而不是抛异常
createButton.props.onClick()
for (let guard = 0; rerenderRequested && guard < 20; guard += 1) {
  rerenderRequested = false
  rerenderRoot()
}
const after = collect(rerenderRoot())
const form = after.find((node) => node.props && node.props['data-dsh-manage'] === 'create')
if (!form) throw new Error('点了「新建技能」但没渲染出创建表单（data-dsh-manage=create 缺失）')

// 3) 取消创建表单，确认回到列表（不写盘）
const cancel = after.find(
  (node) => node.type === 'button' && textOf(node).trim() === '取消' && typeof node.props.onClick === 'function',
)
if (!cancel) throw new Error('创建表单里找不到「取消」按钮')
cancel.props.onClick()
for (let guard = 0; rerenderRequested && guard < 20; guard += 1) {
  rerenderRequested = false
  rerenderRoot()
}
if (collect(rerenderRoot()).some((node) => node.props && node.props['data-dsh-manage'] === 'create')) {
  throw new Error('点了「取消」但创建表单还在')
}

// 4) 七个视图逐个切换：只要求不抛错、且每个视图都渲染出自己的根/加载态。
//    这里不 mock 网络，所以 usage / checks / presets 会停在加载态；关键是
//    切换本身不能触发渲染期 ReferenceError（白屏回归）。
const viewExpectations = {
  list: (nodes) => nodes.some((node) => node.props && node.props['data-dsh-view-panel'] === 'list'),
  groups: (nodes) => nodes.some((node) => node.props && node.props['data-dsh-view-panel'] === 'groups'),
  usage: (nodes) =>
    nodes.some((node) => node.props && node.props['data-dsh-usage'] === 'root') ||
    nodes.some((node) => textOf(node).includes('读取中')),
  trash: (nodes) => nodes.some((node) => node.props && node.props['data-dsh-view-panel'] === 'trash'),
  vault: (nodes) => nodes.some((node) => node.props && node.props['data-dsh-view-panel'] === 'vault'),
  checks: (nodes) =>
    nodes.some((node) => node.props && node.props['data-dsh-checks'] === 'root') ||
    nodes.some((node) => textOf(node).includes('读取中')),
  presets: (nodes) => nodes.some((node) => textOf(node).includes('预设') || textOf(node).includes('读取')),
}

const tabs = collect(rerenderRoot()).filter(
  (node) =>
    node.type === 'button' &&
    node.props &&
    typeof node.props['data-dsh-view'] === 'string' &&
    Object.prototype.hasOwnProperty.call(viewExpectations, node.props['data-dsh-view']),
)
if (tabs.length !== 7) throw new Error(`视图切换应有 7 个按钮，实际 ${tabs.length}`)

for (const [view, expected] of Object.entries(viewExpectations)) {
  const tab = tabs.find((node) => node.props['data-dsh-view'] === view)
  if (!tab || typeof tab.props.onClick !== 'function') throw new Error(`找不到视图按钮：${view}`)
  tab.props.onClick()
  for (let guard = 0; rerenderRequested && guard < 20; guard += 1) {
    rerenderRequested = false
    rerenderRoot()
  }
  const nodes = collect(rerenderRoot())
  if (!expected(nodes)) throw new Error(`视图「${view}」切换后没有渲染出预期内容`)
}

console.log('渲染冒烟通过：首屏可渲染，新建技能表单可开可取消，7 个视图切换均可渲染')
