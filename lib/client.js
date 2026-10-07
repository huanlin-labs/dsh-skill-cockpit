/**
 * dsh-skill-panel · CLIENT half — the 「技能」 page.
 *
 * Bundle format (client-modules protocol): a classic script that registers a
 * factory via window.__ModuleLoader__.load({ id, factory }); the factory
 * receives `require` and returns the plugin's exports (apply/inject).
 * No JSX — plain React.createElement.
 *
 * The page is registered through the THIRD-PARTY service ctx.betterSidebar
 * (dsh-better-sidebar v0.19.0+ turns every registered tab type into a page of
 * DSH's NATIVE right Sidebar), so this plugin never touches an
 * @deepseek-ai/dsh-client-* module and needs no dsh peer range.
 *
 * Every switch state comes from the file name on disk (the host half reads it
 * back on each scan). This page never keeps its own copy of "on/off", so it
 * cannot disagree with what the model can actually load.
 */

window.__ModuleLoader__.load({
  id: 'dsh-skill-panel',
  factory: (require) => {
    // Instrumentation, first statement on purpose: apply() is gated by the
    // loader until the injected service exists, so this line distinguishes
    // "bundle never evaluated" from "evaluated but apply() never ran".
    console.log('[dsh-skill-panel] client bundle evaluated')

    const React = require('react')
    const { useCallback, useEffect, useMemo, useState } = React
    const h = React.createElement

    const BASE = '/__dsh-skill-panel'

    const C = {
      text: 'var(--dsw-color-text, #e8e8e8)',
      dim: 'var(--dsw-color-text-secondary, #9aa0a6)',
      card: 'var(--dsw-color-bg-secondary, rgba(255,255,255,0.04))',
      border: 'var(--dsw-color-border, rgba(255,255,255,0.12))',
      ok: 'var(--dsw-color-success, #4ade80)',
      warn: 'var(--dsw-color-warning, #fbbf24)',
      bad: 'var(--dsw-color-error, #f87171)',
      btn: 'var(--dsw-color-bg-tertiary, rgba(255,255,255,0.10))',
      accent: 'var(--dsw-color-primary, #4d6bfe)',
    }

    const STATUS_LABEL = {
      'dropped:no-frontmatter': '缺 frontmatter',
      'dropped:unclosed': 'frontmatter 未闭合',
      'dropped:bad-yaml': 'YAML 坏',
      'dropped:missing-fields': '缺 name/description',
      'dropped:bad-name': '技能名不合法',
      error: '读文件失败',
    }

    const SOURCE_LABEL = {
      'project-dsh': '项目 .dsh',
      'project-agents': '项目 .agents',
      custom: '自定义',
      'user-dsh': '用户 .dsh',
      'user-agents': '用户 .agents',
      bundled: '内置',
    }

    function fmtBytes(n) {
      if (!n) return '0'
      if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
      if (n >= 1024) return (n / 1024).toFixed(1) + ' KB'
      return n + ' B'
    }

    async function call(path, init) {
      const res = await fetch(path, init)
      let body = null
      try {
        body = await res.json()
      } catch {
        body = null
      }
      if (!res.ok || (body && body.ok === false)) {
        throw new Error((body && body.error) || `HTTP ${res.status}`)
      }
      return body
    }

    function Badge(props) {
      return h(
        'span',
        {
          style: {
            fontSize: '11px',
            lineHeight: '16px',
            padding: '1px 6px',
            borderRadius: '999px',
            border: `1px solid ${props.color || C.border}`,
            color: props.color || C.dim,
            whiteSpace: 'nowrap',
          },
        },
        props.text,
      )
    }

    function Chips(props) {
      const items = [
        ['all', '全部'],
        ['on', '已启用'],
        ['off', '已停用'],
        ['bad', '有问题'],
      ]
      return h(
        'div',
        { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
        items.map(([key, label]) =>
          h(
            'button',
            {
              key,
              onClick: () => props.onPick(key),
              style: {
                cursor: 'pointer',
                fontSize: '12px',
                padding: '2px 8px',
                borderRadius: '999px',
                background: props.value === key ? C.accent : C.btn,
                color: props.value === key ? '#fff' : C.text,
                border: 'none',
              },
            },
            label,
          ),
        ),
      )
    }

    function Row(props) {
      const { skill } = props
      const [open, setOpen] = useState(false)
      const [body, setBody] = useState(null)
      const bad = skill.status !== 'ok'
      const color = bad ? C.bad : skill.enabled ? C.ok : C.dim

      const loadBody = useCallback(async () => {
        if (body !== null) return
        try {
          const data = await call(`${BASE}/body?path=${encodeURIComponent(skill.filePath)}`)
          setBody(data.text ?? '')
        } catch (error) {
          setBody(`读取失败：${error.message}`)
        }
      }, [skill.filePath, body])

      return h(
        'div',
        {
          style: {
            border: `1px solid ${bad ? C.bad : C.border}`,
            borderRadius: '8px',
            padding: '8px 10px',
            marginBottom: '6px',
            background: C.card,
            opacity: skill.enabled ? 1 : 0.72,
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
          h(
            'button',
            {
              title: skill.writable
                ? skill.enabled ? '停用（只改入口文件名）' : '恢复'
                : '该根只读（项目级不写）',
              disabled: !skill.writable || bad && !skill.enabled,
              onClick: () => props.onToggle(skill),
              style: {
                flex: '0 0 auto',
                width: '38px',
                height: '20px',
                borderRadius: '999px',
                border: `1px solid ${color}`,
                background: skill.enabled ? color : 'transparent',
                cursor: skill.writable ? 'pointer' : 'not-allowed',
                position: 'relative',
                opacity: skill.writable ? 1 : 0.5,
              },
            },
            h('span', {
              style: {
                position: 'absolute',
                top: '2px',
                left: skill.enabled ? '20px' : '2px',
                width: '14px',
                height: '14px',
                borderRadius: '50%',
                background: skill.enabled ? '#fff' : color,
                transition: 'left .12s',
              },
            }),
          ),
          h(
            'span',
            { style: { color: C.text, fontSize: '13px', fontWeight: 600, wordBreak: 'break-all' } },
            skill.name,
          ),
          h(Badge, { text: SOURCE_LABEL[skill.source] || skill.source, color: C.dim }),
          h(Badge, { text: skill.source + '#' + skill.rank, color: C.dim }),
          h(Badge, { text: skill.form === 'dir-bundle' ? '目录型' : '扁平型', color: C.dim }),
          skill.enabled ? null : h(Badge, { text: '已停用', color: C.warn }),
          bad ? h(Badge, { text: STATUS_LABEL[skill.status] || skill.status, color: C.bad }) : null,
          skill.shadowed ? h(Badge, { text: '被同名低 rank 遮蔽', color: C.warn }) : null,
          h('span', { style: { flex: '1 1 auto' } }),
          h(Badge, { text: fmtBytes(skill.bytes), color: C.dim }),
          h(
            'button',
            {
              onClick: () => {
                if (!open) loadBody()
                setOpen(!open)
              },
              style: {
                cursor: 'pointer',
                fontSize: '11px',
                padding: '1px 6px',
                borderRadius: '6px',
                background: C.btn,
                color: C.text,
                border: 'none',
              },
            },
            open ? '收起正文' : '看正文',
          ),
        ),
        h(
          'div',
          { style: { color: C.dim, fontSize: '12px', marginTop: '4px', whiteSpace: 'pre-wrap' } },
          bad ? `⚠️ ${skill.reason || skill.status} —— 模型看不到它（文件还在）` : skill.description,
        ),
        h(
          'div',
          { style: { color: C.dim, fontSize: '11px', marginTop: '4px', wordBreak: 'break-all' } },
          skill.filePath,
        ),
        open
          ? h(
              'pre',
              {
                style: {
                  marginTop: '6px',
                  maxHeight: '220px',
                  overflow: 'auto',
                  fontSize: '11px',
                  background: 'rgba(0,0,0,0.25)',
                  color: C.text,
                  padding: '6px',
                  borderRadius: '6px',
                  whiteSpace: 'pre-wrap',
                },
              },
              body === null ? '读入中…' : body,
            )
          : null,
      )
    }

    function SkillPanel(props) {
      const cwd = props && props.scope ? props.scope.cwd : undefined
      const visible = props ? props.visible !== false : true
      const [report, setReport] = useState(null)
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState(false)
      const [filter, setFilter] = useState('all')
      const [query, setQuery] = useState('')
      const [pending, setPending] = useState(null)
      const [hits, setHits] = useState(null)

      const load = useCallback(async () => {
        setBusy(true)
        setError(null)
        try {
          const url = cwd ? `${BASE}/skills?cwd=${encodeURIComponent(cwd)}` : `${BASE}/skills`
          setReport(await call(url))
        } catch (err) {
          setError(err.message)
        } finally {
          setBusy(false)
        }
      }, [cwd])

      useEffect(() => {
        if (visible) load()
      }, [visible, load])

      useEffect(() => {
        const q = query.trim()
        if (q === '') {
          setHits(null)
          return undefined
        }
        let cancelled = false
        const timer = setTimeout(async () => {
          try {
            const data = await call(`${BASE}/undeclared?q=${encodeURIComponent(q)}`)
            if (!cancelled) setHits(data)
          } catch (err) {
            if (!cancelled) setHits({ error: err.message, hits: [] })
          }
        }, 300)
        return () => {
          cancelled = true
          clearTimeout(timer)
        }
      }, [query])

      const applyToggle = useCallback(
        async (target) => {
          setBusy(true)
          setError(null)
          try {
            await call(`${BASE}/toggle`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                filePath: target.filePath,
                disable: !target.enabled,
                cwd,
              }),
            })
            setPending(null)
            await load()
          } catch (err) {
            setError(err.message)
          } finally {
            setBusy(false)
          }
        },
        [cwd, load],
      )

      const skills = report ? report.skills : []
      const filtered = useMemo(() => {
        const q = query.trim().toLowerCase()
        return skills.filter((skill) => {
          if (filter === 'on' && !(skill.enabled && skill.status === 'ok')) return false
          if (filter === 'off' && skill.enabled) return false
          if (filter === 'bad' && skill.status === 'ok') return false
          if (q === '') return true
          return (
            (skill.name || '').toLowerCase().includes(q) ||
            (skill.description || '').toLowerCase().includes(q)
          )
        })
      }, [skills, filter, query])

      const head = report
        ? `共 ${report.summary.totalEntries} 条 · 启用 ${report.summary.enabled} · 停用 ${report.summary.disabled} · 模型实际可见 ${report.summary.visibleToModel}` +
          (report.summary.dropped ? ` · ⚠️ 被丢弃 ${report.summary.dropped}` : '')
        : busy
          ? '读取中…'
          : '（未读取）'

      return h(
        'div',
        { style: { padding: '10px 12px', color: C.text, fontFamily: 'inherit', overflow: 'auto', height: '100%' } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
          h('span', { style: { fontSize: '14px', fontWeight: 700 } }, '技能'),
          h('span', { style: { flex: '1 1 auto' } }),
          h(
            'button',
            {
              onClick: load,
              disabled: busy,
              style: { cursor: 'pointer', fontSize: '12px', padding: '2px 10px', borderRadius: '6px', background: C.btn, color: C.text, border: 'none' },
            },
            busy ? '刷新中…' : '刷新',
          ),
        ),
        h('div', { style: { fontSize: '12px', color: C.dim, marginTop: '6px' } }, head),
        h(
          'div',
          { style: { fontSize: '11px', color: C.dim, marginTop: '2px', wordBreak: 'break-all' } },
          `当前会话 cwd：${cwd || '未知（面板无法算项目级根，只列用户级）'}`,
        ),
        report && report.projectRoot
          ? h('div', { style: { fontSize: '11px', color: C.dim } }, `项目根：${report.projectRoot}`)
          : null,
        error ? h('div', { style: { color: C.bad, fontSize: '12px', marginTop: '6px' } }, `✗ ${error}`) : null,
        h(
          'input',
          {
            value: query,
            placeholder: '筛选已装技能；输入关键词同时查「未安装技能索引」',
            onChange: (e) => setQuery(e.target.value),
            style: {
              width: '100%',
              boxSizing: 'border-box',
              margin: '8px 0 6px',
              padding: '4px 8px',
              fontSize: '12px',
              color: C.text,
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: '6px',
            },
          },
        ),
        h(Chips, { value: filter, onPick: setFilter }),
        pending
          ? h(
              'div',
              {
                style: {
                  margin: '8px 0',
                  padding: '8px',
                  borderRadius: '8px',
                  border: `1px solid ${C.warn}`,
                  background: C.card,
                  fontSize: '12px',
                },
              },
              h('div', { style: { color: C.warn, fontWeight: 600 } }, '确认改名（唯一会写盘的动作）'),
              h('div', { style: { color: C.text, marginTop: '4px', wordBreak: 'break-all' } }, pending.filePath),
              h('div', { style: { color: C.dim } }, '↓'),
              h(
                'div',
                { style: { color: C.text, wordBreak: 'break-all' } },
                pending.enabled ? pending.filePath + '.disabled' : pending.filePath.replace(/\.disabled$/, ''),
              ),
              h(
                'div',
                { style: { display: 'flex', gap: '6px', marginTop: '6px' } },
                h(
                  'button',
                  {
                    onClick: () => applyToggle(pending),
                    disabled: busy,
                    style: { cursor: 'pointer', fontSize: '12px', padding: '2px 10px', borderRadius: '6px', background: C.accent, color: '#fff', border: 'none' },
                  },
                  busy ? '执行中…' : '确认',
                ),
                h(
                  'button',
                  {
                    onClick: () => setPending(null),
                    style: { cursor: 'pointer', fontSize: '12px', padding: '2px 10px', borderRadius: '6px', background: C.btn, color: C.text, border: 'none' },
                  },
                  '取消',
                ),
              ),
            )
          : null,
        h(
          'div',
          { style: { marginTop: '8px' } },
          filtered.length === 0
            ? h('div', { style: { color: C.dim, fontSize: '12px' } }, '没有匹配的已装技能。')
            : filtered.map((skill) =>
                h(Row, {
                  key: skill.source + '|' + skill.rank + '|' + skill.filePath,
                  skill,
                  onToggle: (target) => setPending({ ...target }),
                  onCopy: (text) => navigator.clipboard && navigator.clipboard.writeText(text),
                }),
              ),
        ),
        report
          ? h(
              'div',
              { style: { marginTop: '12px', borderTop: `1px solid ${C.border}`, paddingTop: '8px' } },
              h('div', { style: { fontSize: '12px', fontWeight: 600 } }, '技能根（共 6 类）'),
              report.roots.map((root) =>
                h(
                  'div',
                  { key: root.source + '|' + String(root.path), style: { fontSize: '11px', color: C.dim, marginTop: '2px', wordBreak: 'break-all' } },
                  `${root.source} #${root.rank} · ${root.path === null ? '未挂载' : root.exists ? `${root.skillCount} 条（启用 ${root.enabledCount} / 停用 ${root.disabledCount}）` : '不存在（正常）'} · ${root.writable ? '可写' : '只读'}${root.note ? ' · ' + root.note : ''}`,
                ),
              ),
            )
          : null,
        hits
          ? h(
              'div',
              { style: { marginTop: '12px', borderTop: `1px solid ${C.border}`, paddingTop: '8px' } },
              h('div', { style: { fontSize: '12px', fontWeight: 600 } }, '未安装技能索引（只读 · 不安装）'),
              hits.error
                ? h('div', { style: { color: C.bad, fontSize: '12px' } }, hits.error)
                : hits.hits.length === 0
                  ? h('div', { style: { color: C.dim, fontSize: '12px' } }, hits.note || `索引里没有匹配（共 ${hits.total || 0} 条）`)
                  : hits.hits.map((hit, index) =>
                      h(
                        'div',
                        {
                          key: 'hit' + index,
                          style: { border: `1px solid ${C.border}`, borderRadius: '8px', padding: '6px 8px', marginTop: '6px', background: C.card },
                        },
                        hit.kind === 'table'
                          ? h(
                              'div',
                              { style: { fontSize: '11px', color: C.text } },
                              hit.header.map((col, i) =>
                                h('div', { key: col + i, style: { wordBreak: 'break-all' } }, `${col}：${hit.cells[i] ?? ''}`),
                              ),
                            )
                          : h('div', { style: { fontSize: '11px', color: C.text, wordBreak: 'break-all' } }, `L${hit.line} ${hit.text}`),
                        h(
                          'button',
                          {
                            onClick: () => {
                              const text = hit.kind === 'table'
                                ? hit.header.map((col, i) => `${col}：${hit.cells[i] ?? ''}`).join('\n')
                                : hit.text
                              if (navigator.clipboard) navigator.clipboard.writeText(text)
                            },
                            style: { marginTop: '4px', cursor: 'pointer', fontSize: '11px', padding: '1px 8px', borderRadius: '6px', background: C.btn, color: C.text, border: 'none' },
                          },
                          '复制',
                        ),
                      ),
                    ),
              h('div', { style: { fontSize: '11px', color: C.dim, marginTop: '4px' } }, hits.path ? `索引：${hits.path}` : '索引未配置'),
            )
          : null,
        h(
          'div',
          { style: { fontSize: '11px', color: C.dim, marginTop: '14px' } },
          '开关 = 只改入口文件名（SKILL.md ↔ SKILL.md.disabled）。文件内容一字节不动；停用后立即对模型生效，改回即恢复。',
        ),
      )
    }

    function apply(ctx) {
      // `inject: ['betterSidebar']` (returned below) is REQUIRED: cordis throws
      // "cannot get property betterSidebar without inject" when apply() touches
      // a service it did not declare. Declared and used — never probed.
      try {
        ctx.effect(() =>
          ctx.betterSidebar.registerTab({
            id: 'skill-panel',
            title: '技能',
            description: '本机全部技能（6 类根）· 按技能开关 · 未安装索引第二跳',
            order: 60,
            single: true,
            component: SkillPanel,
          }),
        )
        console.log('[dsh-skill-panel] client: 技能 tab registered on ctx.betterSidebar')
      } catch (error) {
        console.error('[dsh-skill-panel] client: registerTab failed', error)
      }
    }

    return { apply, inject: ['betterSidebar'] }
  },
})
