/**
 * dsh-skill-panel · CLIENT half — the 「技能」 page.
 *
 * Bundle format (client-modules protocol): a classic script that registers a
 * factory via window.__ModuleLoader__.load({ id, factory }); the factory
 * receives `require` and returns the plugin's exports (apply/inject).
 * No JSX — plain React.createElement.
 *
 * MOUNT SURFACE (2026-10-07 rework): the page is an OFFICIAL global panel, not
 * a right-sidebar tab. Two registrations, both through the official `slots`
 * service, exactly like the shipped Plugins / Schedule pages:
 *
 *   1. an ICON into the sidebar shell's root-scoped `sidebar.panellist` LIST
 *      (the application-level nav row) with `order: 5` — strictly between the
 *      shipped Plugins row (order 0) and the shipped Schedule row (order 10);
 *   2. the PAGE into the layout's root-scoped `main` KEYED slot under the same
 *      id — the sidebar row addresses that key, so clicking the row swaps the
 *      center column to this page.
 *
 * Each registration is wrapped in `ctx.slots.inject` (declaration-aware): the
 * callback fires only once the owning shell entry (ui-sidebar / ui-layout) has
 * declared the seat, so load order does not matter and a shell without the
 * seat simply leaves the panel absent instead of failing boot.
 *
 * The page's `cwd` (needed for the project-level skill roots) comes from the
 * framework's standard `useSessions` prop of the `main` seat: its snapshot
 * carries `current` plus `byId[<id>].cwd`. There is no right-sidebar `scope`
 * prop on this seat — that was a betterSidebar-only convenience.
 *
 * Every switch state comes from the file name on disk (the host half reads it
 * back on each scan). This page never keeps its own copy of "on/off", so it
 * cannot disagree with what the model can actually load.
 */

window.__ModuleLoader__.load({
  id: 'dsh-skill-cockpit',
  factory: (require) => {
    // Instrumentation, first statement on purpose: apply() is gated by the
    // loader until the injected service exists, so this line distinguishes
    // "bundle never evaluated" from "evaluated but apply() never ran".
    console.log('[dsh-skill-panel] client bundle evaluated')

    const React = require('react')
    const { useCallback, useEffect, useMemo, useState } = React
    const h = React.createElement

    const BASE = '/__dsh-skill-panel'

    /** Shown in the footer so a running build can be identified at a glance. */
    const VERSION = '0.4.0'

    /** The panel id shared by the nav row and the main-slot page. */
    const PANEL_ID = 'skill-panel'

    /**
     * Row order among the shell's global panel rows. The shipped composition
     * uses Plugins 0 and Schedule 10; the owner asked for the skills entry to
     * sit strictly between those two, so 5 uses the free gap. (The task-board /
     * SSH ecosystem convention documents 0/10/20/30/40 with 30 pencilled in for
     * a "skill center" — see the report; 5 wins here because it is the explicit
     * requirement.)
     */
    const PANEL_ORDER = 5

    /**
     * Host theme tokens. 0.4.0 keeps the 0.3.0 rule (only `--dsw-alias-*`
     * semantic tokens, each with the previous hard-coded colour as its
     * fallback) and fixes the two names 0.3.x got wrong:
     *
     *   - the warn family is `--dsw-alias-state-warn-primary`; there is no
     *     `…-warning-primary` in the host, so the warning colour had been
     *     falling back to its literal forever;
     *   - there is no `--dsw-alias-bg-code`; the real monospace token is
     *     `--ds-font-family-code` and button fills come from
     *     `--dsw-alias-interactive-bg-hover`.
     *
     * Also recorded in the调研 doc: `border-l1` is only 4% ink (invisible as a
     * border) so borders use `-l2`/`-l3`, and `label-primary` is the BODY ink —
     * text only, never an accent.
     */
    const C = {
      text: 'var(--dsw-alias-label-primary, #0f1115)',
      dim: 'var(--dsw-alias-label-secondary, #61666b)',
      faint: 'var(--dsw-alias-label-tertiary, #81858c)',
      caption: 'var(--dsw-alias-label-caption, #adb2b8)',
      card: 'var(--dsw-alias-bg-module-platform, rgba(128,128,128,0.06))',
      hover: 'var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.08))',
      active: 'var(--dsw-alias-interactive-bg-active, rgba(128,128,128,0.16))',
      border: 'var(--dsw-alias-border-l2, rgba(128,128,128,0.13))',
      border2: 'var(--dsw-alias-border-l3, rgba(128,128,128,0.2))',
      ok: 'var(--dsw-alias-state-success-primary, #3fb950)',
      warn: 'var(--dsw-alias-state-warn-primary, #d29922)',
      bad: 'var(--dsw-alias-state-error-primary, #ec1313)',
      btn: 'var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.08))',
      accent: 'var(--dsw-alias-state-business-primary, #4176e6)',
      onAccent: 'var(--dsw-alias-label-primary-foreground, #fff)',
      mono: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)',
      elev: 'var(--dsw-elevation-prominent, 0 3px 8px rgba(0,0,0,0.04), 0 0 20px rgba(0,0,0,0.05))',
      focusRing: 'var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, #4176e6)',
    }

    /** One spacing/type scale for the whole page — 4px base, the host's radii. */
    const S = {
      radiusSm: 'var(--dsw-radius-sm, 8px)',
      radiusMd: 'var(--dsw-radius-md, 12px)',
      radiusLg: 'var(--dsw-radius-lg, 16px)',
      rowPad: '10px 14px',
      gap: '12px',
      pageX: '20px',
      pageY: '28px',
      pageBottom: '44px',
      /** 960px column: wide enough for a full page, narrow enough to read. */
      maxWidth: '960px',
      /** Fixed type ladder: 24 / 15 / 13.5 / 13 / 12.5 / 12 / 11 / 10.5. */
      tTitle: '24px',
      tRowName: '13.5px',
      tBody: '13px',
      tDesc: '12.5px',
      tHint: '12px',
      tMeta: '11px',
      tChip: '10.5px',
      ease: 'cubic-bezier(0.4, 0, 0.2, 1)',
    }

    /**
     * The page's stylesheet. Inline styles cannot express `:hover`,
     * `:focus-visible` or `prefers-reduced-motion`, and those three are exactly
     * what separates a product page from a debug dump — so the panel ships one
     * scoped `<style>` block (every selector prefixed `cockpit-`) and keeps
     * inline styles only for per-item values.
     *
     * Every colour/size is a host token with a literal fallback; no light/dark
     * selector is written here (the theme owner does that, per the host's own
     * styling rule).
     */
    const CSS = `
.cockpit-root{display:flex;flex-direction:column;height:100%;overflow:auto;color:var(--dsw-alias-label-primary,#0f1115);font-family:inherit}
.cockpit-page{width:100%;max-width:960px;margin:0 auto;padding:28px 20px 44px;box-sizing:border-box;display:flex;flex-direction:column;gap:14px}
.cockpit-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.cockpit-title{font-size:24px;font-weight:700;letter-spacing:-.02em;margin:0}
.cockpit-count{font-size:12px;color:var(--dsw-alias-label-tertiary,#81858c);font-variant-numeric:tabular-nums}
.cockpit-hint{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary,#81858c)}
.cockpit-card{background:var(--dsw-alias-bg-module-platform,rgba(128,128,128,.06));border-radius:var(--dsw-radius-md,12px);box-shadow:var(--dsw-elevation-prominent,0 3px 8px rgba(0,0,0,.04));overflow:hidden}
.cockpit-row{display:flex;align-items:center;gap:12px;padding:10px 14px;transition:background .12s cubic-bezier(.4,0,.2,1)}
.cockpit-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.08))}
.cockpit-row+.cockpit-row{border-top:.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.13))}
.cockpit-row:focus-within{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,#4176e6);outline-offset:-2px}
.cockpit-main{flex:1 1 auto;min-width:0}
.cockpit-name{font-size:13.5px;font-weight:600;color:var(--dsw-alias-label-primary,#0f1115);word-break:break-all}
.cockpit-desc{font-size:12.5px;color:var(--dsw-alias-label-tertiary,#81858c);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.cockpit-path{font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;color:var(--dsw-alias-label-caption,#adb2b8);word-break:break-all;margin-top:4px}
.cockpit-body{margin-top:8px;max-height:260px;overflow:auto;font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11.5px;line-height:1.6;white-space:pre-wrap;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.08));border-radius:8px;padding:10px 12px}
.cockpit-meta{display:flex;align-items:center;gap:8px;flex:0 0 auto}
.cockpit-sz{font-size:11px;color:var(--dsw-alias-label-caption,#adb2b8);font-variant-numeric:tabular-nums}
.cockpit-btn{cursor:pointer;border:none;font-size:11px;padding:4px 10px;border-radius:7px;background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.08));color:inherit;transition:background .15s}
.cockpit-btn:hover{background:var(--dsw-alias-interactive-bg-active,rgba(128,128,128,.16))}
.cockpit-btn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,#4176e6);outline-offset:2px}
.cockpit-switch{position:relative;flex:0 0 auto;width:34px;height:20px;padding:0;border-radius:999px;border:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.2));background:var(--dsw-alias-bg-module-platform,rgba(128,128,128,.3));cursor:pointer;transition:background .18s}
.cockpit-switch[data-on="1"]{background:var(--dsw-alias-state-business-primary,#4176e6);border-color:transparent}
.cockpit-switch:disabled{opacity:.45;cursor:not-allowed}
.cockpit-switch:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,#4176e6);outline-offset:2px}
.cockpit-thumb{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .18s}
.cockpit-switch[data-on="1"] .cockpit-thumb{transform:translateX(14px)}
.cockpit-input{width:100%;box-sizing:border-box;padding:9px 12px;border:none;border-radius:10px;background:var(--dsw-alias-bg-module-platform,rgba(128,128,128,.06));color:inherit;font-size:13px;outline:none}
.cockpit-input::placeholder{opacity:.45}
.cockpit-input:focus{background:var(--dsw-alias-interactive-bg-active,rgba(128,128,128,.16))}
.cockpit-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.cockpit-section{display:flex;flex-direction:column;gap:6px;margin-top:6px}
.cockpit-sect-title{font-size:12px;font-weight:700;color:var(--dsw-alias-label-secondary,#61666b);margin:0}
.cockpit-note{font-size:11px;line-height:1.7;color:var(--dsw-alias-label-caption,#adb2b8)}
.cockpit-bad{color:var(--dsw-alias-state-error-primary,#ec1313);font-size:12px}
.cockpit-ok{color:var(--dsw-alias-state-success-primary,#3fb950);font-size:12.5px}
.cockpit-warn{color:var(--dsw-alias-state-warn-primary,#d29922);font-size:12.5px;line-height:1.6}
@media (prefers-reduced-motion:reduce){.cockpit-root *,.cockpit-root *::before{transition-duration:.01ms!important;animation-duration:.01ms!important}}
`

    /**
     * Only these two forms reach the disk as an entry file, and only a file can
     * be switched off by renaming it. Anything else is supplied by a provider
     * through the host's `registerProvider` contract, which is additive: it can
     * contribute its own list() but there is no hook to wrap or exclude someone
     * else's output. So this panel cannot disable those — and says so instead of
     * drawing a switch that would do nothing.
     */
    const FILE_FORMS = ['flat-md', 'dir-bundle']

    const CHECK_LABEL = {
      shadowed: '跨根重名被遮蔽',
      'short-description': '描述为空或过短',
      'dir-name-mismatch': '目录名≠技能名',
      'empty-body': '正文疑似为空',
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

    /**
     * The nav-row glyph. The SIDEBAR SHELL owns the button, the label, the
     * tooltip, the active highlight, the collapsed rail and the panel switch —
     * this component draws only the glyph, at the size and active state the
     * shell supplies.
     *
     * `data-dsh-panel-entry` is pinned because this glyph is the only DOM this
     * plugin owns inside that shell-owned row; the L2 skin contract resolves
     * which row belongs to which plugin through it (the shell stamps no
     * per-entry hook of its own). Same convention as dsh-ssh / task-board.
     * @param props - the shell's icon share: square edge in px and selection.
     */
    function SkillPanelIcon(props) {
      const size = props && typeof props.size === 'number' ? props.size : 16
      return h(
        'svg',
        {
          'data-dsh-panel-entry': PANEL_ID,
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: '1.5',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('path', { d: 'M8 1.6l1.7 4.7L14.4 8l-4.7 1.7L8 14.4l-1.7-4.7L1.6 8l4.7-1.7L8 1.6z' }),
        h('path', { d: 'M12.6 11.4l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5.5-1.4z' }),
      )
    }

    /**
     * A quiet chip. 0.4.0 makes badges neutral by default: the loud coloured
     * pills were a big part of why the list read like a debug dump. A tone is
     * only passed for a genuine exception (disabled / broken / shadowed), which
     * also follows "非默认才打标".
     */
    function Badge(props) {
      // `tone` is the 0.4.0 spelling; the older `color:` call sites still work —
      // they are mapped onto the same three tones so nothing loses its meaning.
      let tone = props.tone
      if (!tone) {
        tone =
          props.color === C.warn ? 'warn' : props.color === C.bad ? 'bad' : props.color === C.ok ? 'ok' : 'plain'
      }
      const accent = tone === 'plain' ? null : C[tone]
      return h(
        'span',
        {
          style: {
            fontSize: S.tChip,
            lineHeight: '15px',
            padding: '0 7px',
            borderRadius: '999px',
            border: `0.5px solid ${accent || C.border2}`,
            color: accent || C.faint,
            whiteSpace: 'nowrap',
            flex: '0 0 auto',
          },
        },
        props.text,
      )
    }

    /**
     * Segmented control: one soft capsule with a single active fill, instead of
     * a row of independent pills. Used for BOTH the view switcher and the
     * filter row so the page has one control language, not two.
     */
    function Segmented(props) {
      return h(
        'div',
        {
          style: {
            display: 'inline-flex',
            gap: '2px',
            padding: '2px',
            borderRadius: S.radiusSm,
            background: C.hover,
            flex: '0 0 auto',
          },
        },
        props.items.map(([key, label]) =>
          h(
            'button',
            {
              key,
              'data-dsh-view': key,
              onClick: () => props.onPick(key),
              style: {
                cursor: 'pointer',
                border: 'none',
                fontSize: S.tHint,
                padding: '4px 12px',
                borderRadius: '6px',
                background: props.value === key ? C.active : 'transparent',
                color: props.value === key ? C.text : C.dim,
                fontWeight: props.value === key ? 600 : 400,
                transition: `background .15s ${S.ease}, color .15s ${S.ease}`,
              },
            },
            label,
          ),
        ),
      )
    }

    function Chips(props) {
      const items = [
        ['all', '全部'],
        ['on', '已启用'],
        ['off', '已停用'],
        ['bad', '有问题'],
      ]
      return h(Segmented, { items, value: props.value, onPick: props.onPick })
    }

    function fmtTime(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms)) return '未知'
      try {
        return new Date(ms).toLocaleString()
      } catch {
        return '未知'
      }
    }

    /** The 列表 / 用量 / 问题 switcher. `data-dsh-view` is the test's stable hook. */
    function ViewTabs(props) {
      const items = [
        ['list', '列表'],
        ['usage', '用量'],
        ['checks', '问题'],
      ]
      return h(Segmented, { items, value: props.value, onPick: props.onPick })
    }

    /**
     * 用量 view. The empty state is the honest one: this machine really does
     * install a lot of skills and call almost none of them, so saying "0 次"
     * without the denominator would be misleading.
     */
    function UsageView(props) {
      const usage = props.usage
      if (props.error) {
        return h('div', { style: { color: C.bad, fontSize: '12px', marginTop: '8px' } }, `✗ 读取用量失败：${props.error}`)
      }
      if (usage === null) {
        return h('div', { style: { color: C.dim, fontSize: '12px', marginTop: '8px' } }, '读取中…')
      }

      const calls = Array.isArray(usage.skills) ? usage.skills : []
      const installed =
        props.report && props.report.summary && typeof props.report.summary.visibleToModel === 'number'
          ? props.report.summary.visibleToModel
          : calls.length
      const sessions = typeof usage.sessions === 'number' ? usage.sessions : 0

      return h(
        'div',
        { 'data-dsh-usage': 'root', style: { marginTop: '8px' } },
        h(
          'div',
          { style: { fontSize: '11px', color: C.dim } },
          `扫描 ${usage.scanned ?? 0} 个会话日志 / 跳过 ${usage.skipped ?? 0} 个（未变化）/ 共 ${sessions} 个会话`,
        ),
        h(
          'div',
          { style: { fontSize: '11px', color: C.dim, marginTop: '2px' } },
          `统计口径：只记技能名、调用次数、最后调用时间；不读也不存任何对话内容（更新于 ${fmtTime(usage.updatedAt)}）`,
        ),
        calls.length === 0
          ? h(
              'div',
              { style: { color: C.warn, fontSize: '13px', marginTop: '10px', lineHeight: '1.6' } },
              `装了 ${installed} 个技能，但最近 ${sessions} 个会话一次都没被调用过。`,
            )
          : h(
              'div',
              { style: { marginTop: '10px' } },
              calls.map((row) =>
                h(
                  'div',
                  {
                    key: 'usage-' + row.name,
                    style: {
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      border: `1px solid ${C.border}`,
                      borderRadius: '8px',
                      padding: '5px 9px',
                      marginBottom: '5px',
                      background: C.card,
                    },
                  },
                  h('span', { style: { color: C.text, fontSize: '13px', fontWeight: 600, wordBreak: 'break-all' } }, row.name),
                  h('span', { style: { flex: '1 1 auto' } }),
                  h(Badge, { text: `${row.count} 次`, color: C.ok }),
                  h('span', { style: { color: C.dim, fontSize: '11px' } }, `最后调用 ${fmtTime(row.lastAt)}`),
                ),
              ),
            ),
        typeof usage.storePath === 'string'
          ? h('div', { style: { fontSize: '11px', color: C.dim, marginTop: '6px', wordBreak: 'break-all' } }, `索引：${usage.storePath}`)
          : null,
      )
    }

    const NON_FILE_NOTE =
      '非文件型技能由 provider 直接提供、不经文件系统。宿主的 registerProvider 契约只允许追加，没有排除别人输出的钩子 ⇒ 只有文件型技能能靠改入口文件名停用。'

    /** 问题 view: the four "loads fine but earns nothing" classes. */
    function ChecksView(props) {
      const data = props.data
      if (props.error) {
        return h('div', { style: { color: C.bad, fontSize: '12px', marginTop: '8px' } }, `✗ 读取诊断失败：${props.error}`)
      }
      if (data === null) {
        return h('div', { style: { color: C.dim, fontSize: '12px', marginTop: '8px' } }, '读取中…')
      }

      const rows = Array.isArray(data.checks) ? data.checks : []
      const summary = data.summary || {}
      const counts = [
        ['shadowed', '跨根重名被遮蔽'],
        ['short-description', '描述为空或过短'],
        ['dir-name-mismatch', '目录名≠技能名'],
        ['empty-body', '正文疑似为空'],
      ]

      return h(
        'div',
        { 'data-dsh-checks': 'root', style: { marginTop: '8px' } },
        h(
          'div',
          { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
          counts.map(([kind, label]) =>
            h(Badge, {
              key: kind,
              text: `${label} ${(summary.byKind && summary.byKind[kind]) || 0}`,
              color: (summary.byKind && summary.byKind[kind]) ? C.warn : C.dim,
            }),
          ),
        ),
        h(
          'div',
          { style: { fontSize: '11px', color: C.dim, marginTop: '6px' } },
          `共扫描 ${data.scannedSkills ?? summary.scanned ?? 0} 条技能条目 · ${data.note || '正文长度按文件字节估计（启发式，不是精确正文长度）'}`,
        ),
        rows.length === 0
          ? h('div', { style: { color: C.ok, fontSize: '12px', marginTop: '10px' } }, '没有发现问题。')
          : h(
              'div',
              { style: { marginTop: '10px' } },
              rows.map((row, index) =>
                h(
                  'div',
                  {
                    key: `check-${row.kind}-${row.skill}-${index}`,
                    style: {
                      border: `1px solid ${C.border}`,
                      borderRadius: '8px',
                      padding: '6px 9px',
                      marginBottom: '5px',
                      background: C.card,
                    },
                  },
                  h(
                    'div',
                    { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
                    h(Badge, { text: CHECK_LABEL[row.kind] || row.kind, color: C.warn }),
                    h('span', { style: { color: C.text, fontSize: '13px', fontWeight: 600, wordBreak: 'break-all' } }, row.skill),
                  ),
                  h('div', { style: { color: C.dim, fontSize: '12px', marginTop: '3px', whiteSpace: 'pre-wrap' } }, row.detail),
                ),
              ),
            ),
        h(
          'div',
          { style: { marginTop: '12px', borderTop: `1px solid ${C.border}`, paddingTop: '8px', fontSize: '11px', color: C.dim, lineHeight: '1.7' } },
          NON_FILE_NOTE,
        ),
      )
    }

    function Row(props) {
      const { skill, cwd } = props
      const [open, setOpen] = useState(false)
      const [body, setBody] = useState(null)
      const bad = skill.status !== 'ok'
      const color = bad ? C.bad : skill.enabled ? C.ok : C.dim
      // Only an entry FILE can be parked by renaming it. A provider-supplied
      // skill has no file and no exclusion hook, so the switch is not drawn at
      // all — a dead switch would be a lie.
      const isFile = FILE_FORMS.indexOf(skill.form) !== -1
      const provider = skill.provider || skill.source

      const loadBody = useCallback(async () => {
        if (body !== null) return
        // The host answers /body only for entry files its own /skills report
        // listed. `cwd` lets that report include project-level roots too; on the
        // standalone page there is no session, and the host then serves every
        // user-level entry and refuses only the project-level ones.
        try {
          const q = `${BASE}/body?path=${encodeURIComponent(skill.filePath)}${
            cwd ? `&cwd=${encodeURIComponent(cwd)}` : ''
          }`
          const data = await call(q)
          setBody(data.text ?? '')
        } catch (error) {
          setBody(`读取失败：${error.message}`)
        }
      }, [skill.filePath, body, cwd])

      // 0.4.0 row model: a transparent band with a hairline separator inside one
      // group card — NOT a boxed card per row (that was the single biggest
      // reason the page read like a debug dump). Only genuine exceptions get a
      // chip, so the default row carries no decoration at all.
      const chips = []
      if (!skill.enabled) chips.push(['已停用', 'warn'])
      if (bad) chips.push([STATUS_LABEL[skill.status] || skill.status, 'bad'])
      if (skill.shadowed) chips.push(['被同名遮蔽', 'warn'])
      // The source chip is the one badge every row keeps: it answers "which root
      // is this from", which no other line on the row does.
      const sourceText = SOURCE_LABEL[skill.source] || skill.source

      return h(
        'div',
        { className: 'cockpit-row', 'data-dsh-skill': skill.name },
        h(
          'div',
          { className: 'cockpit-main' },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } },
            h('span', { className: 'cockpit-name' }, skill.name),
            h(Badge, { text: sourceText, title: skill.source + '#' + skill.rank }),
            chips.map(([text, tone]) => h(Badge, { key: text, text, tone })),
          ),
          h(
            'div',
            { className: 'cockpit-desc', title: skill.description || '' },
            bad ? `⚠️ ${skill.reason || skill.status} —— 模型看不到它（文件还在）` : skill.description,
          ),
          // The raw entry path lives in the expanded view only: on every row it
          // was the single loudest line and the one that made this read as a
          // debug dump.
          open ? h('div', { className: 'cockpit-path' }, skill.filePath) : null,
          open ? h('pre', { className: 'cockpit-body' }, body === null ? '读入中…' : body) : null,
        ),
        h(
          'div',
          { className: 'cockpit-meta' },
          h('span', { className: 'cockpit-sz' }, fmtBytes(skill.bytes)),
          isFile
            ? h(
                'button',
                {
                  title: skill.writable
                    ? skill.enabled ? '停用（只改入口文件名）' : '恢复'
                    : '该根只读（项目级不写）',
                  disabled: props.busy || !skill.writable || bad && !skill.enabled,
                  // Stable hook for the self-test (and for debugging): the switch has no
                  // text of its own, so tests locate it by this attribute, not by label.
                  'data-dsh-skill-toggle': skill.filePath,
                  className: 'cockpit-switch',
                  'data-on': skill.enabled ? '1' : '0',
                  onClick: () => props.onToggle(skill),
                },
                h('span', { className: 'cockpit-thumb' }),
              )
            : h(
                'span',
                {
                  'data-dsh-skill-nofile': skill.name,
                  title: provider,
                  style: { flex: '0 0 auto', color: C.warn, fontSize: '11px', whiteSpace: 'nowrap' },
                },
                `本面板无法禁用（属 ${provider} provider）`,
              ),
          h(
            'button',
            {
              className: 'cockpit-btn',
              onClick: () => {
                if (!open) loadBody()
                setOpen(!open)
              },
            },
            open ? '收起' : '看正文',
          ),
        ),
      )
    }

    /**
     * The panel body. `cwd` is the only thing the mount surface supplies, and
     * it is optional: without it the host returns the user-level roots only and
     * the page says so, instead of pretending a project root exists.
     */
    function SkillPanel(props) {
      const cwd = props ? props.cwd : undefined
      const [report, setReport] = useState(null)
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState(false)
      const [filter, setFilter] = useState('all')
      const [query, setQuery] = useState('')
      const [notice, setNotice] = useState(null)
      const [hits, setHits] = useState(null)
      // 0.3.0 views. Appended AFTER the original seven so their indices are
      // unchanged — the self-test drives state by index.
      const [view, setView] = useState('list')
      const [usage, setUsage] = useState(null)
      const [usageError, setUsageError] = useState(null)
      const [checksData, setChecksData] = useState(null)
      const [checksError, setChecksError] = useState(null)

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

      // The layout mounts this page only while the row is selected, so mount
      // IS the visible state — there is no `visible` prop on this seat.
      useEffect(() => {
        load()
      }, [load])

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

      // 用量 / 问题 are fetched lazily: a fresh install with no invocations
      // still has to pay for a session-log scan, so it must not run on mount.
      useEffect(() => {
        if (view === 'list') return undefined
        let cancelled = false
        const url =
          view === 'usage'
            ? `${BASE}/usage`
            : `${BASE}/checks${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''}`
        ;(async () => {
          try {
            const data = await call(url)
            if (cancelled) return
            if (view === 'usage') {
              setUsage(data)
              setUsageError(null)
            } else {
              setChecksData(data)
              setChecksError(null)
            }
          } catch (err) {
            if (cancelled) return
            if (view === 'usage') setUsageError(err.message)
            else setChecksError(err.message)
          }
        })()
        return () => {
          cancelled = true
        }
      }, [view, cwd])

      const applyToggle = useCallback(
        async (target) => {
          setBusy(true)
          setError(null)
          try {
            const result = await call(`${BASE}/toggle`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                filePath: target.filePath,
                // The switch shows the CURRENT state, so the request carries the
                // OPPOSITE intent: a skill that is on gets disabled. Sending
                // `!target.enabled` here inverted every click (the host answered
                // 400 "该技能当前不是 .disabled，无需恢复"), which is exactly what
                // the confirmation preview above would have contradicted.
                disable: target.enabled === true,
                cwd,
              }),
            })
            // One click = one switch, so say what happened: a silent success would
            // be indistinguishable from the bug this replaced.
            setNotice(
              `${target.enabled ? '已停用' : '已恢复'} ${target.name} · ` +
                (target.enabled ? '入口改名 → .disabled（模型不再可见）' : '入口改回（模型恢复可见）'),
            )
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
        { className: 'cockpit-root', 'data-dsh-plugin': 'skill-panel' },
        h('style', { key: 'cockpit-css' }, CSS),
        h(
          'div',
          { className: 'cockpit-page' },
          h(
            'div',
            { className: 'cockpit-head' },
            h('h1', { className: 'cockpit-title' }, '技能'),
            h('span', { className: 'cockpit-count' }, head),
            h('span', { style: { flex: '1 1 auto' } }),
            h(
              'button',
              { className: 'cockpit-btn', onClick: load, disabled: busy },
              busy ? '刷新中…' : '刷新',
            ),
          ),
          h(
            'div',
            { className: 'cockpit-toolbar' },
            h(ViewTabs, { value: view, onPick: setView }),
            view === 'list' ? h(Chips, { value: filter, onPick: setFilter }) : null,
          ),
          h(
            'div',
            { className: 'cockpit-hint' },
            cwd
              ? `项目根（当前会话）：${cwd}`
              : '项目根：无 —— 本页是全局页，不绑定会话（框架自身的约定：全局面板打开时 current 视为空），故只列用户级技能根',
          ),
          report && report.projectRoot
            ? h('div', { className: 'cockpit-hint' }, `项目根：${report.projectRoot}`)
            : null,
          error ? h('div', { className: 'cockpit-bad' }, `✗ ${error}`) : null,
        view === 'list'
          ? h(
              'div',
              { 'data-dsh-view-panel': 'list', className: 'cockpit-section' },
        h(
          'input',
          {
            className: 'cockpit-input',
            value: query,
            placeholder: '搜索技能名或描述；输入关键词同时查「未安装技能索引」',
            onChange: (e) => setQuery(e.target.value),
          },
        ),
        notice ? h('div', { className: 'cockpit-ok' }, `✓ ${notice}`) : null,
        filtered.length === 0
          ? h('div', { className: 'cockpit-hint' }, '没有匹配的已装技能。')
          : h(
              'div',
              { className: 'cockpit-card' },
              filtered.map((skill) =>
                h(Row, {
                  key: skill.source + '|' + skill.rank + '|' + skill.filePath,
                  skill,
                  cwd,
                  busy,
                  // One click = one switch (owner's call, 2026-10-08). The old
                  // confirm bar turned every toggle into two steps.
                  onToggle: applyToggle,
                }),
              ),
            ),
        h(
          'div',
          { className: 'cockpit-note' },
          '开关即写盘：点一下就把该技能入口改名（唯一会写盘的动作；不改内容、不改目录名）',
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
            )
          : null,
        view === 'usage' ? h(UsageView, { usage, error: usageError, report }) : null,
        view === 'checks' ? h(ChecksView, { data: checksData, error: checksError }) : null,
        h(
          'div',
          { style: { fontSize: '11px', color: C.dim, marginTop: '14px' } },
          '开关 = 只改入口文件名（SKILL.md ↔ SKILL.md.disabled）。文件内容一字节不动；停用后立即对模型生效，改回即恢复。',
        ),
        h(
          'div',
          { style: { fontSize: '11px', color: C.dim, marginTop: '4px' } },
          `面板版本 v${VERSION} · 「用量」读会话日志里的 skill-invocation 计数；「问题」列出能加载但白占坑的技能`,
        ),
        ),
      )
    }

    /**
     * Reads the current Session's cwd through the framework's standard
     * `useSessions` prop and hands it to the body. Split out so the hook is
     * called unconditionally inside THIS component, while the caller decides
     * which component to render — a conditional hook call would break React's
     * ordering rules.
     * @param props - `useSessions` plus everything else for the body.
     */
    function SessionScopedSkillPanel(props) {
      const useSessions = props.useSessions
      const cwd = useSessions((state) => {
        if (!state || !state.current) return undefined
        const summary = state.byId ? state.byId[state.current] : undefined
        return summary ? summary.cwd : undefined
      })
      return h(SkillPanel, { ...props, cwd })
    }

    /**
     * The `main`-slot page. The layout mounts it only while the nav row is
     * selected. `useSessions` is a standard prop of this seat; when a shell
     * hands it over we resolve the project cwd from it, otherwise the body runs
     * in user-level-only mode rather than crashing.
     * @param props - the framework main-slot share.
     */
    function SkillPanelPage(props) {
      if (props && typeof props.useSessions === 'function') {
        return h(SessionScopedSkillPanel, props)
      }
      return h(SkillPanel, props || {})
    }

    function apply(ctx) {
      // `inject: ['slots']` (returned below) is REQUIRED: cordis throws
      // "cannot get property slots without inject" when apply() touches a
      // service it did not declare. Declared and used — never probed.
      try {
        // 1) the application-level nav row (sidebar shell's global panel list)
        const disposeRow = ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: PANEL_ORDER,
              label: '技能',
            },
            SkillPanelIcon,
          ),
        )
        // 2) the whole-page occupant of the center column, addressed by the row
        const disposePage = ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID }, SkillPanelPage),
        )
        ctx.effect(() => () => {
          disposePage()
          disposeRow()
        })
        console.log(
          `[dsh-skill-panel] client: 技能 row + page registered on slots (order ${PANEL_ORDER})`,
        )
      } catch (error) {
        console.error('[dsh-skill-panel] client: slot registration failed', error)
      }
    }

    return { apply, inject: ['slots'] }
  },
})
