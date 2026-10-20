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
    const VERSION = '0.6.8'

  /* ───────────────────────── i18n ─────────────────────────
   * 接宿主 locale 服务（服务名 "locale"，与 @linxin666 / @michengai 的头部
   * 插件同一套契约）：ctx.get('locale') → register(NS, {zh, en}) → bind(NS)。
   * 用 ctx.get 而不是 dsh.client.inject，是为了**不**给宿主加硬依赖：
   * 服务缺席时 t() 回退中文，面板照常工作（注入缺服务会让整块激活失败）。
   * 字典形状是扁平的 'dotted.key' → 文案；{} 占位符由本文件自己插值。
   * ──────────────────────────────────────────────────────── */
  const LOCALE_NS = 'skill-cockpit'
  const MESSAGES = {
    zh: {
      'nav.label': '技能',
      'app.title': '技能',
      'tab.list': '列表',
      'tab.groups': '分组',
      'tab.usage': '用量',
      'tab.checks': '问题',
      'footer.version': '面板版本 v{version}',
      'group.doc': '文档办公',
      'group.code': '代码工程',
      'group.design': '设计视觉',
      'group.write': '写作沟通',
      'group.research': '研究资料',
      'group.meta': '元技能',
      'reason.shadowed': '跨根重名被遮蔽',
      'reason.short': '描述为空或过短',
      'reason.dir': '目录名≠技能名',
      'reason.body': '正文疑似为空',
      'filter.all': '全部',
      'filter.on': '已启用',
      'filter.off': '已停用',
      'filter.bad': '有问题',
      'usage.error': '✗ 读取用量失败：{error}',
      'usage.scanLine': '扫描 {scanned} 个会话日志 · 跳过 {skipped} 个（未变化）· 共 {sessions} 个会话',
      'usage.scopeLine': '统计口径：只记技能名、调用次数、最后调用时间；不读也不存任何对话内容（更新于 {time}）',
      'usage.noneCalled': '装了 {installed} 个技能，但最近 {sessions} 个会话一次都没被调用过',
      'usage.count': '{count} 次',
      'usage.lastAt': '最后调用 {time}',
      'checks.providerNote': '非文件型技能由 provider 直接提供、不经文件系统。宿主的 registerProvider 契约只允许追加，没有排除别人输出的钩子 ⇒ 只有文件型技能能靠改入口文件名停用，这类技能在本面板里只能看、不能开关。',
      'checks.allGood': '没有发现问题。',
      'row.readFailed': '读取失败：{error}',
      'row.badReason': '⚠️ {reason} —— 模型看不到它（文件还在）',
      'common.unknown': '未知',
      'scope.globalPageNote': '项目根：无 —— 本页是全局页，不绑定会话（框架自身的约定：全局面板打开时 current 视为空），故只列用户级技能根',
      'search.placeholder': '搜索技能名或描述；输入关键词同时查「未安装技能索引」',
      'groups.newPlaceholder': '新建一个分组，例如「这个项目要用」',
      'groups.localOnly': '分组只存在本机浏览器里，不写任何技能文件',
      'list.emptyNoMatch': '没有匹配的已装技能。',
      'groups.deleteTitle': '删除这个分组（技能不受影响）',
      'notes.writeOnToggle': '开关即写盘：点一下就把该技能入口改名（唯一会写盘的动作；不改内容、不改目录名）',
      'notes.toggleSemantics': '开关 = 只改入口文件名（SKILL.md ↔ SKILL.md.disabled）。文件内容一字节不动；停用后立即对模型生效，改回即恢复。',
      'roots.title': '技能根（共 6 类）',
      'index.title': '未安装技能索引（只读 · 不安装）',
      'row.addToGroupTitle': '把这个技能加进一个分组',
      'row.readonlyRoot': '该根只读（项目级不写）',
      'common.refresh': '刷新',
      'common.refreshing': '刷新中…',
      'common.copy': '复制',
      'common.unknown': '未知',
      'common.loading': '读取中…',
      'common.loadingBody': '读入中…',
      'common.notLoaded': '（未读取）',
      'chip.disabled': '已停用',
      'chip.shadowed': '被同名遮蔽',
      'list.noDescription': '（这个技能没有写描述）',
      'row.addToGroup': '加入分组…',
      'row.collapse': '收起',
      'row.readBody': '看正文',
      'row.disable': '停用（只改入口文件名）',
      'row.restore': '恢复',
      'row.providerNoFile': '本面板无法禁用（属 {provider} provider）',
      'groups.create': '新建分组',
      'groups.delete': '删除分组',
      'groups.ungrouped': '未分组',
      'groups.memberCount': '{count} 个 · 启用 {on}',
      'groups.enableAllTitle': '整组启用 {count} 个（只改入口文件名）',
      'groups.disableAllTitle': '整组停用 {count} 个（只改入口文件名）',
      'scope.projectRootCurrent': '项目根（当前会话）：{cwd}',
      'scope.projectRoot': '项目根：{root}',
      'footer.line': '面板版本 v{version} · 「用量」读会话日志里的 skill-invocation 计数；「问题」列出能加载但白占坑的技能',
    },
    en: {
      'nav.label': 'Skills',
      'app.title': 'Skill cockpit',
      'tab.list': 'List',
      'tab.groups': 'Groups',
      'tab.usage': 'Usage',
      'tab.checks': 'Problems',
      'footer.version': 'Panel v{version}',
      'group.doc': 'Docs & Office',
      'group.code': 'Code',
      'group.design': 'Design',
      'group.write': 'Writing',
      'group.research': 'Research',
      'group.meta': 'Meta',
      'reason.shadowed': 'Shadowed by a same-named skill',
      'reason.short': 'Description empty or too short',
      'reason.dir': 'Directory name differs from skill name',
      'reason.body': 'Body looks empty',
      'filter.all': 'All',
      'filter.on': 'Enabled',
      'filter.off': 'Disabled',
      'filter.bad': 'Problem',
      'usage.error': '✗ Failed to read usage: {error}',
      'usage.scanLine': 'Scanned {scanned} session logs · skipped {skipped} (unchanged) · {sessions} sessions in total',
      'usage.scopeLine': 'What is recorded: skill name, call count, last call time - no conversation content is read or stored (updated {time})',
      'usage.noneCalled': '{installed} skills installed, but none was called in the last {sessions} sessions',
      'usage.count': '{count} calls',
      'usage.lastAt': 'Last call {time}',
      'checks.providerNote': 'Provider-backed skills never touch the filesystem. The host registerProvider contract only allows appending entries - there is no hook to exclude another provider output, so only file-backed skills can be disabled by renaming their entry file; these can only be inspected here.',
      'checks.allGood': 'No problems found.',
      'row.readFailed': 'Failed to read: {error}',
      'row.badReason': '⚠️ {reason} - the model cannot see it (the file is still there)',
      'common.unknown': 'Unknown',
      'scope.globalPageNote': 'Project root: none - this is a global page with no bound session (the shell treats current as empty for global panels), so only user-level skill roots are listed.',
      'search.placeholder': 'Search by skill name or description; the same keyword also queries the not-installed index.',
      'groups.newPlaceholder': 'New group, e.g. "for this project"',
      'groups.localOnly': 'Groups live only in this browser; no skill file is written.',
      'list.emptyNoMatch': 'No installed skill matches.',
      'groups.deleteTitle': 'Delete this group (skills are untouched)',
      'notes.writeOnToggle': 'The switch writes to disk: one click renames that skill entry file (the only write action; content and directory names are untouched).',
      'notes.toggleSemantics': 'The switch only renames the entry file (SKILL.md to SKILL.md.disabled). Not one byte of content changes; disabling takes effect for the model immediately, and reverting restores it.',
      'roots.title': 'Skill roots (6 kinds)',
      'index.title': 'Not-installed index (read-only, nothing gets installed)',
      'row.addToGroupTitle': 'Put this skill into a group',
      'row.readonlyRoot': 'This root is read-only (project-level roots are never written)',
      'common.refresh': 'Refresh',
      'common.refreshing': 'Refreshing…',
      'common.copy': 'Copy',
      'common.unknown': 'Unknown',
      'common.loading': 'Loading…',
      'common.loadingBody': 'Reading…',
      'common.notLoaded': '(not loaded)',
      'chip.disabled': 'Disabled',
      'chip.shadowed': 'Shadowed',
      'list.noDescription': '(this skill has no description)',
      'row.addToGroup': 'Add to group…',
      'row.collapse': 'Collapse',
      'row.readBody': 'Read body',
      'row.disable': 'Disable (renames the entry file only)',
      'row.restore': 'Restore',
      'row.providerNoFile': 'This panel cannot disable it (comes from the {provider} provider)',
      'groups.create': 'New group',
      'groups.delete': 'Delete group',
      'groups.ungrouped': 'Ungrouped',
      'groups.memberCount': '{count} total · {on} enabled',
      'groups.enableAllTitle': 'Enable all {count} (renames the entry file only)',
      'groups.disableAllTitle': 'Disable all {count} (renames the entry file only)',
      'scope.projectRootCurrent': 'Project root (this session): {cwd}',
      'scope.projectRoot': 'Project root: {root}',
      'footer.line': 'Panel v{version} · Usage counts skill invocations in session logs; Problems lists skills that load but earn nothing',
    },
  }

  /** 宿主 locale 服务绑定出来的翻译函数；缺席时为 null。 */
  let hostTranslate = null

  function interpolate(text, vars) {
    if (!vars || typeof text !== 'string') return text
    return text.replace(/\{(\w+)\}/g, (whole, name) =>
      vars[name] === undefined || vars[name] === null ? whole : String(vars[name]),
    )
  }

  /**
   * 取一条界面文案。顺序：宿主当前语言 → 中文 → key 本身。
   * @param key - 字典里的点分 key。
   * @param vars - 可选的 {} 占位符取值。
   */
  function t(key, vars) {
    let text = MESSAGES.zh[key] === undefined ? key : MESSAGES.zh[key]
    if (hostTranslate) {
      try {
        const localized = hostTranslate(key)
        if (typeof localized === 'string' && localized !== '') text = localized
      } catch {
        /* 宿主翻译函数异常时不打断渲染，保持中文回退 */
      }
    }
    return interpolate(text, vars)
  }

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
.cockpit-detail{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary,#81858c);margin-top:3px;white-space:pre-wrap}
/* 0.5.0 · 分组卡头 / 新建分组 / 行内归属下拉 */
.cockpit-grouphead{display:flex;align-items:center;gap:8px;padding:8px 14px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.1));border-bottom:.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.16))}
.cockpit-groupbox[data-accent='0'] .cockpit-grouphead{box-shadow:inset 3px 0 0 var(--dsw-alias-brand-primary,#4176e6)}
.cockpit-groupbox[data-accent='1'] .cockpit-grouphead{box-shadow:inset 3px 0 0 var(--dsw-alias-state-success-primary,#30a46c)}
.cockpit-groupbox[data-accent='2'] .cockpit-grouphead{box-shadow:inset 3px 0 0 var(--dsw-alias-state-warn-primary,#f5a524)}
.cockpit-groupbox[data-accent='3'] .cockpit-grouphead{box-shadow:inset 3px 0 0 var(--dsw-alias-state-business-primary,#8b5cf6)}
.cockpit-groupbox[data-accent='4'] .cockpit-grouphead{box-shadow:inset 3px 0 0 var(--dsw-alias-state-error-primary,#e5484d)}
.cockpit-groupname{font-size:12px;font-weight:700;color:var(--dsw-alias-label-secondary,#61666b);letter-spacing:.02em}
.cockpit-newgroup{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:2px}
.cockpit-newgroup .cockpit-input{max-width:260px;flex:0 1 260px}
.cockpit-assign{font-size:11px;padding:3px 6px;border-radius:7px;border:.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.13));background:var(--dsw-alias-bg-module-platform,rgba(128,128,128,.06));color:var(--dsw-alias-label-tertiary,#81858c);cursor:pointer}
.cockpit-assign:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.08));color:var(--dsw-alias-label-primary,#0f1115)}
/* 0.6.0 · 分组编辑页（左全部 / 右分组，可拖）—— 技能以看板卡呈现：名字 + 两行描述 */
.cockpit-board{display:grid;grid-template-columns:minmax(0,320px) minmax(0,1fr);gap:14px;align-items:start;margin-top:8px}
.cockpit-groups{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px;align-content:start;align-items:start;min-width:0;max-height:70vh;overflow:auto;padding-right:4px;scrollbar-gutter:stable;overscroll-behavior:contain}
.cockpit-groupbox{border:.5px solid var(--dsw-alias-border-l3,rgba(128,128,128,.2));border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-bg-module-platform,rgba(128,128,128,.07));min-width:0;align-self:start;display:flex;flex-direction:column;height:clamp(240px,40vh,360px);overflow:hidden}
.cockpit-pane{display:flex;flex-direction:column;gap:10px;min-width:0}
.cockpit-pane-list{display:flex;flex-direction:column;gap:6px;padding:10px 12px;max-height:70vh;overflow:auto;scrollbar-gutter:stable;overscroll-behavior:contain}
.cockpit-pane-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:6px;padding:10px 12px;flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable}
.cockpit-skillcard{display:flex;flex-direction:column;gap:3px;padding:8px 10px;border-radius:var(--dsw-radius-sm,8px);border:.5px solid var(--dsw-alias-border-l3,rgba(128,128,128,.2));background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.1));cursor:grab;min-width:0;transition:background .15s,border-color .15s}
.cockpit-skillcard:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.1));border-color:var(--dsw-alias-border-l3,rgba(128,128,128,.22))}
.cockpit-skillcard:active{cursor:grabbing}
.cockpit-skillcard[data-manual="0"]{opacity:.7}
.cockpit-skillcard-top{display:flex;align-items:center;gap:6px}
.cockpit-skillcard-name{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary,#0f1115);word-break:break-all}
.cockpit-skillcard-desc{font-size:11.5px;line-height:1.45;color:var(--dsw-alias-label-tertiary,#81858c);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.cockpit-x{cursor:pointer;border:none;background:transparent;color:var(--dsw-alias-label-caption,#adb2b8);font-size:13px;line-height:1;padding:0 2px}
.cockpit-x:hover{color:var(--dsw-alias-state-error-primary,#e5484d)}
.cockpit-switch[data-mixed='1'] .cockpit-thumb{transform:translateX(7.5px)}
/* 整组停用 ⇒ 整块变灰（和单个技能的停用语义一致） */
[data-dsh-group][data-off='1'],.cockpit-groupbox[data-off='1']{opacity:.55;border-color:var(--dsw-alias-border-l2,rgba(128,128,128,.13))}
.cockpit-groupbox[data-off='1'] .cockpit-grouphead{background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.05))}
/* 次级按钮：安静到 hover 才亮 —— 31 行各一个实心按钮会把列表压垮。 */
.cockpit-btn{cursor:pointer;border:.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.13));font-size:11px;padding:4px 10px;border-radius:7px;background:transparent;color:var(--dsw-alias-label-tertiary,#81858c);transition:background .15s,color .15s,border-color .15s}
.cockpit-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.08));color:var(--dsw-alias-label-primary,#0f1115);border-color:var(--dsw-alias-border-l3,rgba(128,128,128,.2))}
.cockpit-btn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,#4176e6);outline-offset:2px}
/* 分段控件：一个胶囊 + 一道发丝描边，靠实底把「一组」读成一个控件。 */
.cockpit-seg{display:inline-flex;gap:2px;padding:2px;border-radius:8px;background:var(--dsw-alias-bg-module-platform,rgba(128,128,128,.06));border:.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.13))}
.cockpit-seg-btn{cursor:pointer;border:none;font-size:12px;padding:4px 12px;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#61666b);transition:background .15s,color .15s}
.cockpit-seg-btn:hover{color:var(--dsw-alias-label-primary,#0f1115)}
.cockpit-seg-btn[data-active="1"]{background:var(--dsw-alias-interactive-bg-active,rgba(128,128,128,.16));color:var(--dsw-alias-label-primary,#0f1115);font-weight:600}
.cockpit-seg-btn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,#4176e6);outline-offset:1px}
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
      shadowed: 'reason.shadowed',
      'short-description': 'reason.short',
      'dir-name-mismatch': 'reason.dir',
      'empty-body': 'reason.body',
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
        { className: 'cockpit-seg' },
        props.items.map(([key, label]) =>
          h(
            'button',
            {
              key,
              'data-dsh-view': key,
              'data-active': props.value === key ? '1' : '0',
              className: 'cockpit-seg-btn',
              onClick: () => props.onPick(key),
            },
            label,
          ),
        ),
      )
    }

    function Chips(props) {
      const items = [
        ['all', t('filter.all')],
        ['on', t('filter.on')],
        ['off', t('filter.off')],
        ['bad', t('filter.bad')],
      ]
      return h(Segmented, { items, value: props.value, onPick: props.onPick })
    }

    function fmtTime(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms)) return t('common.unknown')
      try {
        return new Date(ms).toLocaleString()
      } catch {
        return t('common.unknown')
      }
    }

    /** The 列表 / 用量 / 问题 switcher. `data-dsh-view` is the test's stable hook. */
    function ViewTabs(props) {
      const items = [
        ['list', t('tab.list')],
        ['groups', t('tab.groups')],
        ['usage', t('tab.usage')],
        ['checks', t('tab.checks')],
      ]
      return h(Segmented, { items, value: props.value, onPick: props.onPick })
    }

    // ---- 0.5.0 · 功能分组 --------------------------------------------------
    //
    // 31 条平铺就是"一坨"。所以按**功能**给每个技能挂 1–3 个标签：
    // 六类基础分类（手写表 + 关键词兜底）+ 用户自建分组（拖动归属）。
    // 归属不写盘：自建分组与手挂关系只存 localStorage，插件仍然只改入口文件名。

    const BASE_GROUPS = [
      { id: 'doc', label: 'group.doc', names: ['docx', 'pptx', 'xlsx', 'pdf', 'html-doc', 'office', 'office-docx', 'office-pptx', 'office-xlsx', 'office-render', 'office-export-pdf', 'office-recalculate'] },
      { id: 'code', label: 'group.code', names: ['code-review', 'debugging', 'testing', 'git-workflow', 'webapp-testing', 'mspm0-ccs', 'web-artifacts', 'claude-api'] },
      { id: 'design', label: 'group.design', names: ['canvas-design', 'gen-art', 'open-design', 'ui-design', 'theme-factory', 'web-artifacts'] },
      { id: 'write', label: 'group.write', names: ['doc-coauthoring', 'internal-comms', 'content-predict', 'distill-book', 'cot-we-need', 'html-doc', 'academic-writing', 'citation-check', 'reviewer-response'] },
      { id: 'research', label: 'group.research', names: ['material-vault', 'zotero', 'deeptutor', 'video-understand', 'distill-book', 'literature-review'] },
      { id: 'meta', label: 'group.meta', names: ['session-memory', 'skill-creator', 'find-skills', 'cot-we-need', 'claude-api', 'agent-experience', 'cordis-plugin-development', 'cordis-composition-reference', 'editing-cordis-compositions', 'diagnose-windows-sandbox-acl'] },
    ]

    /** 关键词兜底：新装的技能没有手写映射时靠描述猜一类，猜不出进「未分组」。 */
    const KEYWORD_RULES = [
      ['doc', /文档|表格|电子表格|\bpdf\b|\bword\b|powerpoint|幻灯片|spreadsheet/i],
      ['code', /代码|调试|测试|审查|git|编译|构建|类型|重构|api/i],
      ['design', /设计|视觉|配色|主题|海报|封面|图形|界面|布局|艺术/i],
      ['write', /写作|沟通|文案|提案|润色|摘要|稿件/i],
      ['research', /资料|文献|论文|检索|归档|研究|书|课程|视频/i],
      ['meta', /技能|会话|记忆|元|提示词|风格/i],
    ]

    const GROUPS_KEY = 'dsh-skill-panel.groups.v1'
    const UNGROUPED = 'ungrouped'

    /** localStorage 不可用（无痕等）时静默降级：只剩六类基础分组。 */
    function readGroupState() {
      try {
        const raw = window.localStorage.getItem(GROUPS_KEY)
        if (!raw) return { groups: [], assign: {} }
        const parsed = JSON.parse(raw)
        return {
          groups: Array.isArray(parsed.groups) ? parsed.groups.filter((g) => g && g.id && g.label) : [],
          assign: parsed.assign && typeof parsed.assign === 'object' ? parsed.assign : {},
        }
      } catch {
        return { groups: [], assign: {} }
      }
    }

    function writeGroupState(state) {
      try {
        window.localStorage.setItem(GROUPS_KEY, JSON.stringify(state))
      } catch {
        /* 写不进去就当本次会话有效 */
      }
    }

    /** 一个技能的全部标签：手写表 → 关键词兜底 → 用户手挂。 */
    function tagsOf(skill, groupState) {
      const name = String(skill.name || '')
      const tags = []
      for (const g of BASE_GROUPS) if (g.names.indexOf(name) !== -1) tags.push(g.id)
      if (tags.length === 0) {
        const text = name + ' ' + String(skill.description || '')
        for (const rule of KEYWORD_RULES) {
          if (rule[1].test(text)) tags.push(rule[0])
          if (tags.length >= 2) break
        }
      }
      for (const g of groupState.groups) {
        const members = groupState.assign[g.id]
        if (Array.isArray(members) && members.indexOf(name) !== -1) tags.push(g.id)
      }
      return tags
    }

    function allGroups(groupState) {
      return BASE_GROUPS.concat(
        groupState.groups.map((g) => ({ id: g.id, label: g.label, names: [], custom: true })),
      )
    }

    /** 基础分组的 label 存的是字典 key；用户自建组存的是用户输入的原名。 */
    function groupText(group) {
      return group && group.custom ? String(group.label) : t(group.label)
    }

    function groupLabelOf(groupId, groupState) {
      const found = allGroups(groupState).filter((g) => g.id === groupId)[0]
      return found ? groupText(found) : groupId
    }

    /**
     * 用量 view. The empty state is the honest one: this machine really does
     * install a lot of skills and call almost none of them, so saying "0 次"
     * without the denominator would be misleading.
     */
    function UsageView(props) {
      const usage = props.usage
      if (props.error) {
        return h('div', { className: 'cockpit-bad' }, t('usage.error', { error: props.error }))
      }
      if (usage === null) {
        return h('div', { className: 'cockpit-hint' }, t('common.loading'))
      }

      const calls = Array.isArray(usage.skills) ? usage.skills : []
      const installed =
        props.report && props.report.summary && typeof props.report.summary.visibleToModel === 'number'
          ? props.report.summary.visibleToModel
          : calls.length
      const sessions = typeof usage.sessions === 'number' ? usage.sessions : 0

      return h(
        'div',
        { 'data-dsh-usage': 'root', className: 'cockpit-section' },
        h(
          'div',
          { className: 'cockpit-hint' },
          t('usage.scanLine', { scanned: usage.scanned ?? 0, skipped: usage.skipped ?? 0, sessions }),
        ),
        h(
          'div',
          { className: 'cockpit-note' },
          t('usage.scopeLine', { time: fmtTime(usage.updatedAt) }),
        ),
        calls.length === 0
          ? h('div', { className: 'cockpit-warn' }, t('usage.noneCalled', { installed, sessions }))
          : h(
              'div',
              { className: 'cockpit-card' },
              calls.map((row) =>
                h(
                  'div',
                  { key: 'usage-' + row.name, className: 'cockpit-row' },
                  h('div', { className: 'cockpit-main' }, h('div', { className: 'cockpit-name' }, row.name)),
                  h(
                    'div',
                    { className: 'cockpit-meta' },
                    h(Badge, { text: t('usage.count', { count: row.count }), tone: 'ok' }),
                    h('span', { className: 'cockpit-sz' }, t('usage.lastAt', { time: fmtTime(row.lastAt) })),
                  ),
                ),
              ),
            ),
        typeof usage.storePath === 'string'
          ? h('div', { className: 'cockpit-note', style: { wordBreak: 'break-all' } }, `索引：${usage.storePath}`)
          : null,
      )
    }

    const NON_FILE_NOTE =
      t('checks.providerNote')

    /** 问题 view: the four "loads fine but earns nothing" classes. */
    function ChecksView(props) {
      const data = props.data
      if (props.error) {
        return h('div', { style: { color: C.bad, fontSize: '12px', marginTop: '8px' } }, `✗ 读取诊断失败：${props.error}`)
      }
      if (data === null) {
        return h('div', { style: { color: C.dim, fontSize: '12px', marginTop: '8px' } }, t('common.loading'))
      }

      const rows = Array.isArray(data.checks) ? data.checks : []
      const summary = data.summary || {}
      const counts = [
        ['shadowed', 'reason.shadowed'],
        ['short-description', 'reason.short'],
        ['dir-name-mismatch', 'reason.dir'],
        ['empty-body', 'reason.body'],
      ]

      return h(
        'div',
        { 'data-dsh-checks': 'root', className: 'cockpit-section' },
        h(
          'div',
          { className: 'cockpit-toolbar' },
          counts.map(([kind, label]) => {
            const n = (summary.byKind && summary.byKind[kind]) || 0
            return h(Badge, { key: kind, text: `${t(label)} ${n}`, tone: n ? 'warn' : 'plain' })
          }),
        ),
        h(
          'div',
          { className: 'cockpit-note' },
          `共扫描 ${data.scannedSkills ?? summary.scanned ?? 0} 条技能条目 · ${data.note || '正文长度按文件字节估计（启发式，不是精确正文长度）'}`,
        ),
        rows.length === 0
          ? h('div', { className: 'cockpit-ok' }, t('checks.allGood'))
          : h(
              'div',
              { className: 'cockpit-card' },
              rows.map((row, index) =>
                h(
                  'div',
                  { key: `check-${row.kind}-${row.skill}-${index}`, className: 'cockpit-row', style: { alignItems: 'flex-start' } },
                  h(
                    'div',
                    { className: 'cockpit-main' },
                    h(
                      'div',
                      { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
                      h(Badge, { text: CHECK_LABEL[row.kind] ? t(CHECK_LABEL[row.kind]) : row.kind, tone: 'warn' }),
                      h('span', { className: 'cockpit-name' }, row.skill),
                    ),
                    h('div', { className: 'cockpit-detail' }, row.detail),
                  ),
                ),
              ),
            ),
        h('div', { className: 'cockpit-note', style: { borderTop: `0.5px solid ${C.border}`, paddingTop: '8px' } }, NON_FILE_NOTE),
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
          setBody(t('row.readFailed', { error: error.message }))
        }
      }, [skill.filePath, body, cwd])

      // 0.4.0 row model: a transparent band with a hairline separator inside one
      // group card — NOT a boxed card per row (that was the single biggest
      // reason the page read like a debug dump). Only genuine exceptions get a
      // chip, so the default row carries no decoration at all.
      const chips = []
      if (!skill.enabled) chips.push([t('chip.disabled'), 'warn'])
      if (bad) chips.push([STATUS_LABEL[skill.status] || skill.status, 'bad'])
      if (skill.shadowed) chips.push([t('chip.shadowed'), 'warn'])
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
            (props.tags || []).map((tag) => h(Badge, { key: 'tag-' + tag, text: tag })),
          ),
          h(
            'div',
            { className: 'cockpit-desc', title: skill.description || '' },
            bad ? t('row.badReason', { reason: skill.reason || skill.status }) : skill.description,
          ),
          // The raw entry path lives in the expanded view only: on every row it
          // was the single loudest line and the one that made this read as a
          // debug dump.
          open ? h('div', { className: 'cockpit-path' }, skill.filePath) : null,
          open ? h('pre', { className: 'cockpit-body' }, body === null ? t('common.loadingBody') : body) : null,
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
                    ? skill.enabled ? t('row.disable') : t('row.restore')
                    : t('row.readonlyRoot'),
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
                t('row.providerNoFile', { provider }),
              ),
          props.onAssign && props.groups && props.groups.length
            ? h(
                'select',
                {
                  className: 'cockpit-assign',
                  title: t('row.addToGroupTitle'),
                  value: '',
                  onChange: (e) => {
                    const picked = e.target.value
                    if (picked) props.onAssign(skill.name, picked, true)
                    e.target.value = ''
                  },
                },
                [h('option', { key: '__', value: '' }, t('row.addToGroup'))].concat(
                  props.groups.map((g) => h('option', { key: g.id, value: g.id }, groupText(g))),
                ),
              )
            : null,
          h(
            'button',
            {
              className: 'cockpit-btn',
              onClick: () => {
                if (!open) loadBody()
                setOpen(!open)
              },
            },
            open ? t('row.collapse') : t('row.readBody'),
          ),
        ),
      )
    }

    /**
     * The panel body. `cwd` is the only thing the mount surface supplies, and
     * it is optional: without it the host returns the user-level roots only and
     * the page says so, instead of pretending a project root exists.
     */
    /**
     * 分组编辑页（0.6.0 起）：左＝全部技能，右＝分组。
     * 技能以**看板卡**呈现（名字 + 两行描述），拖动即归组；自建组可改名、可删除。
     * 归属只写 localStorage —— 插件对磁盘唯一的写动作仍是改入口文件名。
     */
    function GroupsView(props) {
      const state = props.groupState
      const groups = allGroups(state)
      const byName = {}
      for (const skill of props.skills) byName[skill.name] = skill

      const descOf = (name) => {
        const skill = byName[name]
        if (!skill || typeof skill.description !== 'string') return t('list.noDescription')
        const flat = skill.description.replace(/\s+/g, ' ').trim()
        return flat === '' ? t('list.noDescription') : flat
      }

      const membersOf = (group) => {
        const def = BASE_GROUPS.filter((g) => g.id === group.id)[0]
        const computed = def ? props.skills.filter((s) => def.names.indexOf(s.name) !== -1).map((s) => s.name) : []
        const manual = Array.isArray(state.assign[group.id]) ? state.assign[group.id] : []
        const seen = {}
        const out = []
        for (const name of manual) {
          if (seen[name]) continue
          seen[name] = 1
          out.push({ name, manual: true })
        }
        for (const name of computed) {
          if (seen[name]) continue
          seen[name] = 1
          out.push({ name, manual: false })
        }
        return out
      }

      const onDragStart = (name) => (event) => {
        event.dataTransfer.setData('text/plain', name)
        event.dataTransfer.effectAllowed = 'copy'
      }

      const onDropTo = (groupId) => (event) => {
        event.preventDefault()
        const name = event.dataTransfer.getData('text/plain')
        if (name) props.onAssign(name, groupId, true)
      }

      return h(
        'div',
        { 'data-dsh-view-panel': 'groups', className: 'cockpit-section' },
        h(
          'div',
          { className: 'cockpit-newgroup' },
          h('input', {
            className: 'cockpit-input',
            value: props.newGroupLabel,
            placeholder: '新建分组，例如「这个项目要用」',
            onChange: (e) => props.setNewGroupLabel(e.target.value),
            onKeyDown: (e) => {
              if (e.key === 'Enter') props.onAddGroup()
            },
          }),
          h('button', { className: 'cockpit-btn', onClick: props.onAddGroup }, t('groups.create')),
          h('span', { className: 'cockpit-note' }, '把左边的卡拖到右边的组里；带 × 的是你手动放的，没有 × 的是按功能自动归类的'),
        ),
        h(
          'div',
          { className: 'cockpit-board' },
          // 左：全部技能（卡片列表，可拖）
          h(
            'div',
            { className: 'cockpit-pane' },
            h(
              'div',
              { className: 'cockpit-grouphead' },
              h('span', { className: 'cockpit-groupname' }, '全部技能'),
              h('span', { className: 'cockpit-count' }, `${props.skills.length} 个`),
            ),
            h(
              'div',
              { className: 'cockpit-pane-list' },
              props.skills.map((skill) =>
                h(
                  'div',
                  {
                    key: 'card-' + skill.name,
                    className: 'cockpit-skillcard',
                    draggable: true,
                    title: descOf(skill.name),
                    onDragStart: onDragStart(skill.name),
                  },
                  h('div', { className: 'cockpit-skillcard-name' }, skill.name),
                  h('div', { className: 'cockpit-skillcard-desc' }, descOf(skill.name)),
                ),
              ),
            ),
          ),
          // 右：分组（每组一个可接收掉落的框）
          h(
            'div',
            { className: 'cockpit-groups' },
            groups.map((group, groupIndex) => {
              const members = membersOf(group)
              const onCount = members.filter((m) => byName[m.name] && byName[m.name].enabled).length
              return h(
                'div',
                {
                  key: 'box-' + group.id,
                  className: 'cockpit-groupbox',
                  'data-accent': String(groupIndex % 5),
                  'data-off': onCount === 0 ? '1' : '0',
                  onDragOver: (event) => {
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'copy'
                  },
                  onDrop: onDropTo(group.id),
                },
                h(
                  'div',
                  { className: 'cockpit-grouphead' },
                  group.custom
                    ? h('input', {
                        className: 'cockpit-input',
                        style: { maxWidth: '200px' },
                        value: groupText(group),
                        onChange: (e) => props.onRenameGroup(group.id, e.target.value),
                        title: '改分组名',
                      })
                    : h('span', { className: 'cockpit-groupname' }, groupText(group)),
                  h('span', { className: 'cockpit-count' }, `${members.length}`),
                  h('span', { style: { flex: '1 1 auto' } }),
                  h(
                    'button',
                    {
                      className: 'cockpit-switch',
                      'data-on': onCount > 0 ? '1' : '0',
                      'data-mixed': onCount > 0 && onCount < members.length ? '1' : '0',
                      title: onCount === 0 ? '整组启用（只改入口文件名）' : '整组停用（只改入口文件名）',
                      onClick: () => props.onGroupToggle(members.map((m) => m.name), onCount > 0),
                    },
                    h('span', { className: 'cockpit-thumb' }),
                  ),
                  group.custom
                    ? h(
                        'button',
                        {
                          className: 'cockpit-btn',
                          onClick: () => props.onRemoveGroup(group.id),
                          title: '删除该分组（技能不受影响）',
                        },
                        t('groups.delete'),
                      )
                    : null,
                ),
                h(
                  'div',
                  { className: 'cockpit-pane-grid' },
                  members.length === 0
                    ? h('span', { className: 'cockpit-hint' }, '把左边的卡片拖进来')
                    : members.map((member) =>
                        h(
                          'div',
                          {
                            key: group.id + '-' + member.name,
                            className: 'cockpit-skillcard',
                            'data-manual': member.manual ? '1' : '0',
                            draggable: true,
                            title: descOf(member.name),
                            onDragStart: onDragStart(member.name),
                          },
                          h(
                            'div',
                            { className: 'cockpit-skillcard-top' },
                            h('span', { className: 'cockpit-skillcard-name' }, member.name),
                            h('span', { style: { flex: '1 1 auto' } }),
                            member.manual
                              ? h(
                                  'button',
                                  {
                                    className: 'cockpit-x',
                                    title: '移出该组',
                                    onClick: (event) => {
                                      event.stopPropagation()
                                      props.onAssign(member.name, group.id, false)
                                    },
                                  },
                                  '×',
                                )
                              : null,
                          ),
                          h('div', { className: 'cockpit-skillcard-desc' }, descOf(member.name)),
                        ),
                      ),
                ),
              )
            }),
          ),
        ),
      )
    }

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
      // 0.5.0 · 用户自建分组与手挂归属（只存 localStorage，不写盘）
      const [groupStateRaw, setGroupStateRaw] = useState(readGroupState)
      // 归一化：localStorage 损坏、或渲染环境没有真实 useState 时一律退化成空状态，
      // 绝不让分组数据把整页打挂。
      const groupState =
        groupStateRaw && Array.isArray(groupStateRaw.groups) && groupStateRaw.assign
          ? groupStateRaw
          : { groups: [], assign: {} }
      const [newGroupLabel, setNewGroupLabel] = useState('')
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
        if (view !== 'usage' && view !== 'checks') return undefined
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

      // ---- 0.5.0 · 功能分组 -------------------------------------------------
      const groups = allGroups(groupState)
      const grouped = useMemo(() => {
        const map = { [UNGROUPED]: [] }
        for (const g of BASE_GROUPS) map[g.id] = []
        for (const g of groupState.groups) map[g.id] = []
        for (const skill of filtered) {
          const tags = tagsOf(skill, groupState)
          if (tags.length === 0) map[UNGROUPED].push(skill)
          else for (const t of tags) if (map[t]) map[t].push(skill)
        }
        return map
      }, [filtered, groupState])
      const groupedOrder = groups.map((g) => g.id).concat([UNGROUPED])

      /** 归属只动 localStorage —— 插件对磁盘唯一的写动作仍然是改入口文件名。 */
      const assignSkill = useCallback((skillName, groupId, add) => {
        setGroupStateRaw((prev) => {
          const assign = Object.assign({}, prev.assign)
          const list = Array.isArray(assign[groupId]) ? assign[groupId].slice() : []
          const idx = list.indexOf(skillName)
          if (add && idx === -1) list.push(skillName)
          if (!add && idx !== -1) list.splice(idx, 1)
          if (list.length === 0) delete assign[groupId]
          else assign[groupId] = list
          const next = { groups: prev.groups, assign }
          writeGroupState(next)
          return next
        })
      }, [])

      const addGroup = useCallback(() => {
        const label = newGroupLabel.trim()
        if (label === '') return
        setGroupStateRaw((prev) => {
          const id = 'u' + Date.now().toString(36)
          const next = { groups: prev.groups.concat([{ id, label }]), assign: prev.assign }
          writeGroupState(next)
          return next
        })
        setNewGroupLabel('')
      }, [newGroupLabel])

      const removeGroup = useCallback((groupId) => {
        setGroupStateRaw((prev) => {
          const assign = Object.assign({}, prev.assign)
          delete assign[groupId]
          const next = { groups: prev.groups.filter((g) => g.id !== groupId), assign }
          writeGroupState(next)
          return next
        })
      }, [])

      const renameGroup = useCallback((groupId, label) => {
        setGroupStateRaw((prev) => {
          const next = {
            groups: prev.groups.map((g) => (g.id === groupId ? { id: g.id, label } : g)),
            assign: prev.assign,
          }
          writeGroupState(next)
          return next
        })
      }, [])
      /** 整组开/关：逐个走同一个 /toggle（每个都只改入口文件名）。 */
      // 整组开/停：逐个走同一个 /toggle（每个都只改入口文件名）。
      // 关键：**任何情况下都要给反馈** —— 之前"没有可写目标就静默 return"，
      // 表现就是"点了没反应"。
      const applyGroupToggle = useCallback(
        async (members, disable) => {
          const action = disable ? '停用' : '启用'
          // 要停用 ⇒ 目标是"当前启用"的；要启用 ⇒ 目标是"当前停用"的。
          // 这里原来写成 `s.enabled === !disable`，方向正好反了 ⇒ want 永远为空 ⇒
          // 无论点哪个都提示"已经全部…了，无需操作"。
          const want = members.filter((s) => Boolean(s.enabled) === Boolean(disable))
          if (want.length === 0) {
            setNotice(`这一组已经全部${action}了，无需操作`)
            return
          }
          const writable = want.filter((s) => s.writable)
          const skipped = want.length - writable.length
          if (writable.length === 0) {
            setError(`这一组有 ${skipped} 个技能所在目录不允许写（项目级技能根只读），没法${action}`)
            return
          }
          setBusy(true)
          setError(null)
          let ok = 0
          let failed = 0
          let firstError = ''
          for (const skill of writable) {
            try {
              await call(`${BASE}/toggle`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ filePath: skill.filePath, disable, cwd }),
              })
              ok += 1
            } catch (err) {
              failed += 1
              if (firstError === '') firstError = `${skill.name}: ${err.message}`
            }
          }
          setNotice(
            `整组${action}：成功 ${ok}` +
              (skipped ? ` · 跳过 ${skipped} 个（只读）` : '') +
              (failed ? ` · 失败 ${failed}` : ''),
          )
          if (failed) setError(`有 ${failed} 个没成功，第一个是 ${firstError}`)
          await load()
          setBusy(false)
        },
        [cwd, load],
      )

      const head = report
        ? `共 ${report.summary.totalEntries} 条 · 启用 ${report.summary.enabled} · 停用 ${report.summary.disabled} · 模型实际可见 ${report.summary.visibleToModel}` +
          (report.summary.dropped ? ` · ⚠️ 被丢弃 ${report.summary.dropped}` : '')
        : busy
          ? t('common.loading')
          : t('common.notLoaded')

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
            h('h1', { className: 'cockpit-title' }, t('app.title')),
            h('span', { className: 'cockpit-count' }, head),
            h('span', { style: { flex: '1 1 auto' } }),
            h(
              'button',
              { className: 'cockpit-btn', onClick: load, disabled: busy },
              busy ? t('common.refreshing') : t('common.refresh'),
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
              ? t('scope.projectRootCurrent', { cwd })
              : t('scope.globalPageNote'),
          ),
          report && report.projectRoot
            ? h('div', { className: 'cockpit-hint' }, t('scope.projectRoot', { root: report.projectRoot }))
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
            placeholder: t('search.placeholder'),
            onChange: (e) => setQuery(e.target.value),
          },
        ),
        notice ? h('div', { className: 'cockpit-ok' }, `✓ ${notice}`) : null,
        // 自建分组入口：新建的组会出现在下面，行内「分组…」下拉可把技能挂进去。
        h(
          'div',
          { className: 'cockpit-newgroup' },
          h('input', {
            className: 'cockpit-input',
            value: newGroupLabel,
            placeholder: t('groups.newPlaceholder'),
            onChange: (e) => setNewGroupLabel(e.target.value),
            onKeyDown: (e) => {
              if (e.key === 'Enter') addGroup()
            },
          }),
          h('button', { className: 'cockpit-btn', onClick: addGroup }, t('groups.create')),
          h('span', { className: 'cockpit-note' }, t('groups.localOnly')),
        ),
        filtered.length === 0
          ? h('div', { className: 'cockpit-hint' }, t('list.emptyNoMatch'))
          : groupedOrder.map((gid) => {
              const members = grouped[gid] || []
              if (members.length === 0) return null
              const def = gid === UNGROUPED ? null : groups.filter((g) => g.id === gid)[0]
              const onCount = members.filter((s) => s.enabled).length
              const head = def ? groupText(def) : t('groups.ungrouped')
              return h(
                'div',
                {
                  key: 'group-' + gid,
                  className: 'cockpit-card',
                  'data-dsh-group': gid,
                  'data-off': onCount === 0 ? '1' : '0',
                },
                h(
                  'div',
                  { className: 'cockpit-grouphead' },
                  h('span', { className: 'cockpit-groupname' }, head),
                  h('span', { className: 'cockpit-count' }, t('groups.memberCount', { count: members.length, on: onCount })),
                  h('span', { style: { flex: '1 1 auto' } }),
                  h(
                    'button',
                    {
                      className: 'cockpit-switch',
                      'data-on': onCount > 0 ? '1' : '0',
                      'data-mixed': onCount > 0 && onCount < members.length ? '1' : '0',
                      'data-dsh-group-switch': gid,
                      disabled: busy,
                      title:
                        onCount === 0
                          ? t('groups.enableAllTitle', { count: members.length })
                          : t('groups.disableAllTitle', { count: members.length }),
                      onClick: () => applyGroupToggle(members, onCount > 0),
                    },
                    h('span', { className: 'cockpit-thumb' }),
                  ),
                  def && def.custom
                    ? h(
                        'button',
                        {
                          className: 'cockpit-btn',
                          onClick: () => removeGroup(gid),
                          title: t('groups.deleteTitle'),
                        },
                        t('groups.delete'),
                      )
                    : null,
                ),
                members.map((skill) =>
                  h(Row, {
                    key: skill.source + '|' + skill.rank + '|' + skill.filePath,
                    skill,
                    cwd,
                    busy,
                    tags: tagsOf(skill, groupState).map((t) => groupLabelOf(t, groupState)),
                    groups,
                    onAssign: assignSkill,
                    onToggle: applyToggle,
                  }),
                ),
              )
            }),
        h(
          'div',
          { className: 'cockpit-note' },
          t('notes.writeOnToggle'),
        ),
        report
          ? h(
              'div',
              { style: { marginTop: '12px', borderTop: `1px solid ${C.border}`, paddingTop: '8px' } },
              h('div', { style: { fontSize: '12px', fontWeight: 600 } }, t('roots.title')),
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
              h('div', { style: { fontSize: '12px', fontWeight: 600 } }, t('index.title')),
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
                          t('common.copy'),
                        ),
                      ),
                    ),
              h('div', { style: { fontSize: '11px', color: C.dim, marginTop: '4px' } }, hits.path ? `索引：${hits.path}` : '索引未配置'),
            )
          : null,
            )
          : null,
        view === 'groups'
          ? h(GroupsView, {
              skills,
              groupState,
              onAssign: assignSkill,
              onAddGroup: addGroup,
              onRemoveGroup: removeGroup,
              onRenameGroup: renameGroup,
              onGroupToggle: (names, disable) =>
                applyGroupToggle(names.map((n) => skills.filter((s) => s.name === n)[0]).filter(Boolean), disable),
              newGroupLabel,
              setNewGroupLabel,
            })
          : null,
        view === 'usage' ? h(UsageView, { usage, error: usageError, report }) : null,
        view === 'checks' ? h(ChecksView, { data: checksData, error: checksError }) : null,
        h(
          'div',
          { style: { fontSize: '11px', color: C.dim, marginTop: '14px' } },
          t('notes.toggleSemantics'),
        ),
        h(
          'div',
          { style: { fontSize: '11px', color: C.dim, marginTop: '4px' } },
          t('footer.line', { version: VERSION }),
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
      // 宿主 locale 服务是**可选**依赖：ctx.get 拿不到就保持中文回退。
      const localeService = typeof ctx.get === 'function' ? ctx.get('locale') : null
      if (localeService && typeof localeService.register === 'function') {
        try {
          ctx.effect(() => localeService.register(LOCALE_NS, MESSAGES), 'skill-cockpit: dictionaries')
        } catch {
          /* 注册失败只影响翻译，不影响面板 */
        }
        try {
          if (typeof localeService.bind === 'function') hostTranslate = localeService.bind(LOCALE_NS)
        } catch {
          /* 绑定失败同上 */
        }
      }
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
              label: t('nav.label'),
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
