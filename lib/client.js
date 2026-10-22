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
    const VERSION = '0.6.13'

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
      'tab.checks': '体检',
      'checkup.banner': '{total} 个技能 · {visible} 个模型可见 · {dropped} 个被丢弃',
      'checkup.bannerOk': '体检通过：{total} 条技能，没发现问题',
      'checkup.bannerBad': '体检发现 {issues} 个问题 · {fixable} 个可一键修',
      'checkup.bannerSub': '共 {total} 条 · 模型可见 {visible} · 点这里看逐条原因',
      'checkup.bannerGo': '查看体检 →',
      'checkup.bannerHint': '点一下打开体检页',
      'checkup.fixes': '可以怎么办',
      'checkup.fixWrites': '要改文件',
      'checkup.fixSafe': '只改设置',
      'checkup.location': '位置',
      'footer.version': '面板版本 v{version}',
      'status.noFrontmatter': '缺 frontmatter',
      'status.unclosed': 'frontmatter 未闭合',
      'status.badYaml': 'YAML 坏',
      'status.missingFields': '缺 name/description',
      'status.badName': '技能名不合法',
      'status.readError': '读文件失败',
      'source.projectDsh': '项目 .dsh',
      'source.projectAgents': '项目 .agents',
      'source.custom': '自定义',
      'source.userDsh': '用户 .dsh',
      'source.userAgents': '用户 .agents',
      'source.bundled': '内置',
      'usage.index': '索引：{path}',
      'checks.error': '✗ 读取诊断失败：{error}',
      'checks.summary': '共扫描 {scanned} 条技能条目 · {note}',
    'checks.neverTitle': '能加载，但从来没被调用过（{count} 个 · 近 {sessions} 个会话）',
    'checks.neverNone': '所有可写技能都至少被调用过一次',
    'checks.neverRow': '{sessions} 个会话 0 次',
    'checks.neverDisable': '停用',
      'checks.noteFallback': '正文长度按文件字节估计（启发式，不是精确正文长度）',
      'groups.boardPlaceholder': '新建分组，例如「这个项目要用」',
      'groups.boardNote': '把左边的卡拖到右边的组里；带 × 的是你手动放的，没有 × 的是按功能自动归类的',
      'groups.allSkills': '全部技能',
      'groups.count': '{count} 个',
      'groups.searchPlaceholder': '搜技能名或描述…',
      'groups.searchNone': '没有匹配的技能',
      'groups.renameTitle': '改分组名',
      'groups.enableAllShort': '整组启用（只改入口文件名）',
      'groups.disableAllShort': '整组停用（只改入口文件名）',
      'groups.deleteShortTitle': '删除该分组（技能不受影响）',
      'groups.dropHint': '把左边的卡片拖进来',
      'groups.removeTitle': '移出该组',
      'notify.disabled': '已停用',
      'notify.restored': '已恢复',
      'notify.disabledHow': '入口改名 → .disabled（模型不再可见）',
      'notify.proof': '已复扫验证：模型可见 {before} → {after}（本次扫描 {scanned} 条）',
      'tab.presets': '预设',
      'preset.hint': '预设 = 把当前这一套技能状态存下来。以后一键回到这套组合。只存你这里能改的技能，provider 技能与只读根不会进预设。',
      'preset.namePlaceholder': '给这套组合起个名，如「写文档」',
      'preset.capture': '把当前状态存为预设',
      'preset.defaultName': '未命名预设',
      'preset.none': '当前没有可存的技能（都需要是能改的入口文件）',
      'preset.saved': '已存「{n}」，含 {c} 个技能',
      'preset.empty': '还没有预设。调好各技能的开关后，点上面的按钮存一套。',
      'preset.count': '{n} 个技能',
      'preset.drop': '删除',
      'preset.plan': '看会发生什么',
      'preset.apply': '应用这套',
      'preset.applied': '已改 {n} 个（每个都留了 .bak 备份）',
      'preset.applyFail': '改到第 {n} 个时失败：{e} —— 后面的都没动',
      'preset.planResult': '{w} 个要改 · {u} 个已经是目标态 · {m} 个找不到 · {b} 个改不了（只读预览，没动盘）',
      'preset.planFail': '算不出来：',
      'mode.on': '全开',
      'mode.userOnly': '仅人工',
      'mode.modelOnly': '仅模型',
      'mode.off': '关',
      'mode.switchTitle': '点一下切到下一态（四态循环）',
      'notify.modeSet': '已切换',
      'notify.backup': '备份',
      'notify.restoredHow': '入口改回（模型恢复可见）',
      'action.disable': '停用',
      'action.enable': '启用',
      'groupToggle.allDone': '这一组已经全部{action}了，无需操作',
      'groupToggle.readonly': '这一组有 {count} 个技能所在目录不允许写（项目级技能根只读），没法{action}',
      'groupToggle.resultHead': '整组{action}：成功 {ok}',
      'groupToggle.resultSkipped': ' · 跳过 {count} 个（只读）',
      'groupToggle.resultFailed': ' · 失败 {count}',
      'groupToggle.firstError': '有 {count} 个没成功，第一个是 {error}',
      'roots.summary': '共 {total} 条 · 启用 {enabled} · 停用 {disabled} · 模型实际可见 {visible}',
      'roots.dropped': ' · ⚠️ 被丢弃 {count}',
      'roots.line': '{source} #{rank} · {state} · {writable}{note}',
      'roots.notMounted': '未挂载',
      'roots.missing': '不存在（正常）',
      'roots.counts': '{skills} 条（启用 {enabled} / 停用 {disabled}）',
      'roots.writable': '可写',
      'roots.readonly': '只读',
      'roots.noteSuffix': ' · {note}',
      'index.noMatch': '索引里没有匹配（共 {count} 条）',
      'index.notConfigured': '索引未配置',
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
    'groups.modeTitle': '整组切换：把这一组全部设成同一档',
    'groupMode.allDone': '这一组已经全是{label}，无需操作',
    'groupMode.done': '{count} 个技能已设为{label}',
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
      'tab.checks': 'Checkup',
      'checkup.banner': '{total} skills · {visible} visible to model · {dropped} dropped',
      'checkup.bannerOk': 'checkup passed: {total} skills, no issues found',
      'checkup.bannerBad': '{issues} issues found · {fixable} fixable in one click',
      'checkup.bannerSub': '{total} skills · {visible} visible to the model · click for per-item reasons',
      'checkup.bannerGo': 'Open checkup →',
      'checkup.bannerHint': 'Click to open the checkup page',
      'checkup.fixes': 'What you can do',
      'checkup.fixWrites': 'changes a file',
      'checkup.fixSafe': 'settings only',
      'checkup.location': 'Location',
      'footer.version': 'Panel v{version}',
      'status.noFrontmatter': 'Missing frontmatter',
      'status.unclosed': 'Unclosed frontmatter',
      'status.badYaml': 'Broken YAML',
      'status.missingFields': 'Missing name or description',
      'status.badName': 'Invalid skill name',
      'status.readError': 'Failed to read the file',
      'source.projectDsh': 'Project .dsh',
      'source.projectAgents': 'Project .agents',
      'source.custom': 'Custom',
      'source.userDsh': 'User .dsh',
      'source.userAgents': 'User .agents',
      'source.bundled': 'Bundled',
      'usage.index': 'Index: {path}',
      'checks.error': '✗ Failed to read diagnostics: {error}',
      'checks.summary': 'Scanned {scanned} skill entries · {note}',
    'checks.neverTitle': 'Loadable but never called ({count} · last {sessions} sessions)',
    'checks.neverNone': 'Every writable skill has been called at least once',
    'checks.neverRow': '0 calls in {sessions} sessions',
    'checks.neverDisable': 'Disable',
      'checks.noteFallback': 'Body length is estimated from file bytes (heuristic, not exact)',
      'groups.boardPlaceholder': 'New group, e.g. "for this project"',
      'groups.boardNote': 'Drag a card from the left into a group on the right; an × marks a manual placement, no × means auto-classified by function',
      'groups.allSkills': 'All skills',
      'groups.count': '{count} skills',
      'groups.searchPlaceholder': 'Search skills…',
      'groups.searchNone': 'No matching skills',
      'groups.renameTitle': 'Rename this group',
      'groups.enableAllShort': 'Enable all (renames the entry file only)',
      'groups.disableAllShort': 'Disable all (renames the entry file only)',
      'groups.deleteShortTitle': 'Delete this group (skills are untouched)',
      'groups.dropHint': 'Drag a card here from the left',
      'groups.removeTitle': 'Remove from this group',
      'notify.disabled': 'Disabled',
      'notify.restored': 'Restored',
      'notify.disabledHow': 'entry renamed to .disabled (the model no longer sees it)',
      'notify.proof': 'verified by rescan: model-visible {before} → {after} ({scanned} entries scanned)',
      'tab.presets': 'presets',
      'preset.hint': 'A preset is a snapshot of the current skill states. One click brings the whole combination back. Only skills this panel can change are captured.',
      'preset.namePlaceholder': 'Name this combination, e.g. "writing"',
      'preset.capture': 'Save current state as a preset',
      'preset.defaultName': 'Untitled preset',
      'preset.none': 'Nothing to capture (only writable entry files can be saved)',
      'preset.saved': 'Saved "{n}" with {c} skills',
      'preset.empty': 'No presets yet. Set the switches, then save a combination above.',
      'preset.count': '{n} skills',
      'preset.drop': 'delete',
      'preset.plan': 'what would change',
      'preset.apply': 'apply this one',
      'preset.applied': '{n} changed (each left a .bak backup)',
      'preset.applyFail': 'failed on #{n}: {e} — the rest were left alone',
      'preset.planResult': '{w} to change, {u} already right, {m} missing, {b} not writable (read-only preview, nothing touched)',
      'preset.planFail': 'cannot compute: ',
      'mode.on': 'full',
      'mode.userOnly': 'human only',
      'mode.modelOnly': 'model only',
      'mode.off': 'off',
      'mode.switchTitle': 'Click to cycle through the four states',
      'notify.modeSet': 'switched',
      'notify.backup': 'backup',
      'notify.restoredHow': 'entry renamed back (the model sees it again)',
      'action.disable': 'disable',
      'action.enable': 'enable',
      'groupToggle.allDone': 'Every skill in this group is already {action}d',
      'groupToggle.readonly': '{count} skills in this group live in a read-only root (project-level roots are never written), so they cannot be {action}d',
      'groupToggle.resultHead': 'Group {action}: {ok} succeeded',
      'groupToggle.resultSkipped': ' · {count} skipped (read-only)',
      'groupToggle.resultFailed': ' · {count} failed',
      'groupToggle.firstError': '{count} failed; the first was {error}',
      'roots.summary': '{total} entries · {enabled} enabled · {disabled} disabled · {visible} visible to the model',
      'roots.dropped': ' · ⚠️ {count} dropped',
      'roots.line': '{source} #{rank} · {state} · {writable}{note}',
      'roots.notMounted': 'not mounted',
      'roots.missing': 'missing (normal)',
      'roots.counts': '{skills} entries ({enabled} enabled / {disabled} disabled)',
      'roots.writable': 'writable',
      'roots.readonly': 'read-only',
      'roots.noteSuffix': ' · {note}',
      'index.noMatch': 'No match in the index ({count} entries)',
      'index.notConfigured': 'Index not configured',
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
    'groups.modeTitle': 'Set the whole group to one state',
    'groupMode.allDone': 'Every skill in this group is already {label}',
    'groupMode.done': 'Set {count} skill(s) to {label}',
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
.cockpit-checkhead{display:flex;gap:8px;align-items:center;flex-wrap:wrap;cursor:pointer;user-select:none}
.cockpit-fixes{margin-top:8px;padding:8px 10px;border-left:2px solid var(--dsw-alias-line-secondary,#e4e6e8);background:var(--dsw-alias-bg-secondary,#f8f9fa);border-radius:6px}
.cockpit-fix{padding:6px 0}
.cockpit-fix+.cockpit-fix{border-top:1px dashed var(--dsw-alias-line-secondary,#e4e6e8)}
.cockpit-fixhead{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.cockpit-fixlabel{font-size:12px;color:var(--dsw-alias-label-primary,#1f2329)}
.cockpit-mode{flex:0 0 auto;font-size:11px;line-height:18px;padding:0 7px;border-radius:999px;border:0.5px solid var(--dsw-alias-line-secondary,#e4e6e8);color:var(--dsw-alias-label-secondary,#646a73);cursor:pointer;user-select:none;white-space:nowrap}.cockpit-mode:hover{background:rgba(128,128,128,.2);border-color:rgba(128,128,128,.55)}.cockpit-mode-wrap{display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap}.cockpit-mode-menu{display:inline-flex;gap:2px;padding:2px;border-radius:999px;background:rgba(128,128,128,.18);border:1px solid rgba(128,128,128,.35)}.cockpit-mode-item{padding:0 8px;line-height:18px;border-radius:999px;cursor:pointer;font-size:11px;white-space:nowrap;color:inherit}.cockpit-mode-item:hover{background:rgba(128,128,128,.3)}.cockpit-mode-item.is-on{background:#4c8dff;color:#fff;font-weight:600}.cockpit-mode-wrap,[data-dsh-skill-toggle]{display:none!important}.cockpit-seg{display:inline-flex;padding:2px;border-radius:999px;background:rgba(128,128,128,.15);border:1px solid rgba(128,128,128,.28)}.cockpit-seg-item{padding:0 9px;line-height:20px;border-radius:999px;cursor:pointer;font-size:11px;white-space:nowrap;color:inherit;opacity:.7}.cockpit-seg-item:hover{opacity:1;background:rgba(128,128,128,.22)}.cockpit-seg-item.is-on{background:#4c8dff;color:#fff;font-weight:600;opacity:1}
.cockpit-mode:hover{border-color:var(--dsw-alias-line-primary,#c9cdd4)}
.cockpit-mode[data-mode="on"]{color:var(--dsw-alias-label-tertiary,#8f959e)}
.cockpit-mode[data-mode="user-only"]{color:var(--dsw-alias-state-warning,#b26a00);border-color:var(--dsw-alias-state-warning,#b26a00)}
.cockpit-mode[data-mode="model-only"]{color:var(--dsw-alias-state-business-primary,#4176e6);border-color:var(--dsw-alias-state-business-primary,#4176e6)}
.cockpit-mode[data-mode="off"]{color:var(--dsw-alias-label-tertiary,#8f959e);text-decoration:line-through}.cockpit-presets{padding:4px 0}
.cockpit-presetbar{display:flex;gap:8px;align-items:center;margin:10px 0}
.cockpit-presetname{flex:1 1 auto;min-width:0;padding:5px 9px;font-size:12px;border-radius:6px;border:0.5px solid var(--dsw-alias-line-secondary,#e4e6e8);background:var(--dsw-alias-bg-base,#fff);color:inherit}
.cockpit-preset{display:flex;gap:10px;align-items:center;padding:8px 10px;border-radius:8px;border:0.5px solid var(--dsw-alias-line-secondary,#e4e6e8);margin-bottom:6px}
.cockpit-empty{padding:18px 0;font-size:12px;color:var(--dsw-alias-label-tertiary,#8f959e)}.cockpit-checkup{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 12px;margin:0 0 10px;border:1px solid rgba(128,128,128,.28);border-radius:10px;background:rgba(128,128,128,.13);color:inherit;font-size:12px;cursor:pointer;user-select:none;white-space:pre-line;line-height:1.55}
.cockpit-checkup:hover{border-color:var(--dsw-alias-line-primary,#c9ccd1)}
.cockpit-checkup-go{color:#4c8dff;font-weight:600;white-space:nowrap}
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
.cockpit-newgroup{display:flex;align-items:center;gap:8px;margin:0;flex:1 1 100%;justify-content:flex-end}
.cockpit-nevercard{display:flex;flex-wrap:wrap;gap:6px;padding:10px;margin-top:6px;border-radius:10px;background:rgba(128,128,128,.06);border:.5px solid rgba(128,128,128,.16)}
.cockpit-neverpill{display:inline-flex;align-items:center;gap:6px;padding:3px 6px 3px 10px;border-radius:999px;background:rgba(128,128,128,.12);font-size:12px;line-height:1.6;color:inherit}
.cockpit-neverpill button{padding:0 2px;border:0;background:transparent;color:inherit;opacity:.5;font-size:11.5px;cursor:pointer;font-family:inherit}
.cockpit-neverpill button:hover{opacity:1}
.cockpit-newgroup .cockpit-input{width:280px;flex:0 0 280px;max-width:none;padding:7px 10px;font-size:12.5px;border-radius:9px}
.cockpit-assign-wrap{position:relative;display:inline-flex}
.cockpit-assign{font-size:11px;padding:3px 8px;border-radius:7px;border:.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.28));background:var(--dsw-alias-bg-module-platform,rgba(128,128,128,.1));color:var(--dsw-alias-label-secondary,#646a73);cursor:pointer;user-select:none;white-space:nowrap}
.cockpit-assign:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.2));color:var(--dsw-alias-label-primary,#0f1115)}
/* 原生 <select> 的下拉由系统绘制，深色主题下会变成白底浅灰字 —— 所以换成自绘菜单。
   Canvas/CanvasText 是系统色，随 color-scheme 自动翻转，两种主题都保证对比度。 */
.cockpit-assign-menu{position:absolute;right:0;top:calc(100% + 4px);z-index:60;min-width:140px;max-height:240px;overflow:auto;display:flex;flex-direction:column;gap:2px;padding:5px;border-radius:9px;border:1px solid rgba(128,128,128,.45);background:Canvas;color:CanvasText;color-scheme:light dark;box-shadow:0 8px 24px rgba(0,0,0,.28)}
.cockpit-assign-item{padding:5px 8px;border-radius:6px;font-size:12px;line-height:16px;color:inherit;cursor:pointer;white-space:nowrap}
.cockpit-assign-item:hover{background:rgba(128,128,128,.3)}
/* 0.6.0 · 分组编辑页（左全部 / 右分组，可拖）—— 技能以看板卡呈现：名字 + 两行描述 */
.cockpit-board{display:grid;grid-template-columns:minmax(0,320px) minmax(0,1fr);gap:14px;align-items:start;margin-top:8px}
.cockpit-groups{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px;align-content:start;align-items:start;min-width:0;max-height:70vh;overflow:auto;padding-right:4px;scrollbar-gutter:stable;overscroll-behavior:contain}
.cockpit-groupbox{border:.5px solid var(--dsw-alias-border-l3,rgba(128,128,128,.2));border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-bg-module-platform,rgba(128,128,128,.07));min-width:0;align-self:start;display:flex;flex-direction:column;height:clamp(240px,40vh,360px);overflow:hidden}
.cockpit-pane{display:flex;flex-direction:column;gap:10px;min-width:0}
.cockpit-pane-search{margin:0 12px;width:calc(100% - 24px);box-sizing:border-box}
.cockpit-pane-list{display:flex;flex-direction:column;gap:6px;padding:10px 12px;max-height:70vh;overflow:auto;scrollbar-gutter:stable;overscroll-behavior:contain}
.cockpit-pane-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:6px;padding:10px 12px;flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable}
.cockpit-skillcard{position:relative;display:flex;flex-direction:column;gap:3px;padding:8px 10px;border-radius:var(--dsw-radius-sm,8px);border:.5px solid var(--dsw-alias-border-l3,rgba(128,128,128,.2));background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.1));cursor:grab;min-width:0;transition:background .15s,border-color .15s}
.cockpit-skillcard:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.1));border-color:var(--dsw-alias-border-l3,rgba(128,128,128,.22))}
.cockpit-skillcard:active{cursor:grabbing}
.cockpit-skillcard[data-manual="0"]{opacity:.7}
.cockpit-skillcard-top{display:flex;align-items:center;gap:6px;padding-right:24px}
.cockpit-skillcard-name{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary,#0f1115);word-break:break-all}
.cockpit-skillcard-desc{font-size:11.5px;line-height:1.45;color:var(--dsw-alias-label-tertiary,#81858c);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.cockpit-x{position:absolute;top:0;right:0;cursor:pointer;border:0;background:rgba(128,128,128,.12);color:var(--dsw-alias-label-caption,#adb2b8);font-size:15px;line-height:1;width:26px;height:26px;display:inline-flex;align-items:flex-start;justify-content:flex-end;padding:4px 6px 0 0;border-radius:0 var(--dsw-radius-sm,8px) 0 8px;transition:background .15s,color .15s}
.cockpit-x:hover{background:rgba(128,128,128,.2);color:var(--dsw-alias-state-error-primary,#e5484d)}
.cockpit-x:active{background:rgba(128,128,128,.3)}
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
/* 输入框：给一道发丝描边，占位文字提亮到看得清 —— 只靠淡灰底 + 45% 白字，字会糊成一片。 */
.cockpit-input{width:100%;box-sizing:border-box;padding:8px 12px;border:.5px solid rgba(128,128,128,.2);border-radius:10px;background:rgba(128,128,128,.1);color:inherit;font-size:13.5px;line-height:1.5;outline:none;transition:background .15s,border-color .15s}
.cockpit-input::placeholder{color:inherit;opacity:.6}
.cockpit-input:focus{background:rgba(128,128,128,.16);border-color:rgba(128,128,128,.38)}
.cockpit-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.cockpit-search{position:relative;flex:1 1 100%;min-width:0;display:flex}
.cockpit-search .cockpit-input{flex:1 1 auto}
/* 实心次级按钮：新建分组要有"能点"的分量，不能跟说明文字一个观感。 */
.cockpit-btn-solid{border-color:transparent;background:rgba(128,128,128,.2);color:inherit;font-weight:600}
.cockpit-btn-solid:hover{background:rgba(128,128,128,.3);color:inherit}
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
// 四态循环顺序：全开 → 仅人工 → 仅模型 → 关 → 全开。
// 显示顺序固定，不在数组里藏逻辑 —— 点一下就是下一个，用户按两次就能猜出来。
const MODE_ORDER = ['on', 'user-only', 'model-only', 'off']
const MODE_LABEL = {
  on: 'mode.on',
  'user-only': 'mode.userOnly',
  'model-only': 'mode.modelOnly',
  off: 'mode.off',
}

    const CHECK_LABEL = {
      shadowed: 'reason.shadowed',
      'short-description': 'reason.short',
      'dir-name-mismatch': 'reason.dir',
      'empty-body': 'reason.body',
    }

    const STATUS_LABEL = {
      'dropped:no-frontmatter': 'status.noFrontmatter',
      'dropped:unclosed': 'status.unclosed',
      'dropped:bad-yaml': 'status.badYaml',
      'dropped:missing-fields': 'status.missingFields',
      'dropped:bad-name': 'status.badName',
      error: 'status.readError',
    }

    const SOURCE_LABEL = {
      'project-dsh': 'source.projectDsh',
      'project-agents': 'source.projectAgents',
      custom: 'source.custom',
      'user-dsh': 'source.userDsh',
      'user-agents': 'source.userAgents',
      bundled: 'source.bundled',
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
        ['checks', t('tab.checks')],
        ['list', t('tab.list')],
        ['groups', t('tab.groups')],
      ['presets', t('tab.presets')],
        ['usage', t('tab.usage')],
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

    /**
     * 分组状态只有一份（localStorage），所以内存里的也必须是**一份**。
     *
     * 本插件同时注册两处面板：右栏标签（sidebar.panellist）与主界面页面（main）。
     * 两处各自 mount 一份 SkillPanel —— 原来各自 useState(readGroupState)，各存一份快照：
     * 在右栏把 canvas-design 拖进「文档办公」，右栏计数变 6，主界面那一份还是 5，
     * 因为它的快照是 mount 时读的，之后没人通知它（2026-10-21 户主实测：这俩不同步）。
     * 现在改为模块级共享快照 + 订阅：写入即广播，两处同时重渲染。
     */
    const groupListeners = new Set()
    let groupCache = null

    function groupSnapshot() {
      if (groupCache === null) groupCache = readGroupState()
      return groupCache
    }

    function emitGroup() {
      for (const fn of Array.from(groupListeners)) {
        try {
          fn(groupCache)
        } catch {
          /* 一个订阅者坏了，不能连累其它面板 */
        }
      }
    }

    function writeGroupStore(updater) {
      const next = typeof updater === 'function' ? updater(groupSnapshot()) : updater
      groupCache = next
      writeGroupState(next)
      emitGroup()
      return next
    }

    function subscribeGroup(fn) {
      groupListeners.add(fn)
      return () => {
        groupListeners.delete(fn)
      }
    }

    // 别的窗口改了 localStorage：同窗口不触发 storage 事件，所以跨窗口靠它兜底。
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('storage', (event) => {
        if (!event || event.key !== GROUPS_KEY) return
        groupCache = readGroupState()
        emitGroup()
      })
    }

    /**
     * 技能开关同理：A 面板点了「关」，B 面板必须重拉 /skills，否则显示的还是旧状态。
     * 带 origin：发起方自己已经在等 load() 的返回值做证据，不必再拉一次。
     */
    const skillListeners = new Set()

    function emitSkillsChanged(origin) {
      for (const fn of Array.from(skillListeners)) {
        try {
          fn(origin)
        } catch {
          /* 同上 */
        }
      }
    }

    function subscribeSkills(fn) {
      skillListeners.add(fn)
      return () => {
        skillListeners.delete(fn)
      }
    }

    /** 一个技能的全部标签：手写表 → 关键词兜底 → 用户手挂（基础组与自建组都算）。 */
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
      // 2026-10-21：这里原来只遍历 groupState.groups（自建组），基础组的手挂被丢掉 ——
      // 在「分组」页把 canvas-design 拖进「文档办公」，分组框显示 6、列表页同一组还是 5。
      // 分组页读的是 assign[组id]（基础组也读），列表页靠这里算 tag，两边口径必须一致。
      for (const g of allGroups(groupState)) {
        const members = groupState.assign[g.id]
        if (Array.isArray(members) && members.indexOf(name) !== -1 && tags.indexOf(g.id) === -1) {
          tags.push(g.id)
        }
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
          ? h('div', { className: 'cockpit-note', style: { wordBreak: 'break-all' } }, t('usage.index', { path: usage.storePath }))
          : null,
      )
    }

    const NON_FILE_NOTE =
      t('checks.providerNote')

    /** 问题 view: the four "loads fine but earns nothing" classes. */
    /**
     * 一条体检问题：默认只显示「哪类问题 + 哪个技能 + 一句话原因」，
     * 点开才展开「可以怎么办」。解法库由 host 的 checks[].fixes 提供
     * （lib/checks.js 的 FIX_LIBRARY），每条带后果与是否要动用户文件。
     * 默认收起是故意的：问题多时先让人扫一遍，而不是一上来灌满屏。
     */
    function CheckRow(props) {
      const { row } = props
      const [open, setOpen] = useState(false)
      const fixes = Array.isArray(row.fixes) ? row.fixes : []
      return h(
        'div',
        { className: 'cockpit-row', style: { alignItems: 'flex-start' }, 'data-dsh-check-row': row.kind },
        h(
          'div',
          { className: 'cockpit-main' },
          h(
            'div',
            { className: 'cockpit-checkhead', onClick: () => setOpen(!open) },
            h(Badge, { text: CHECK_LABEL[row.kind] ? t(CHECK_LABEL[row.kind]) : row.kind, tone: 'warn' }),
            h('span', { className: 'cockpit-name' }, row.skill),
            h('span', { className: 'cockpit-count' }, open ? '▾' : '▸'),
          ),
          h('div', { className: 'cockpit-detail' }, row.detail),
          open
            ? h(
                'div',
                { className: 'cockpit-fixes' },
                fixes.length > 0 ? h('div', { className: 'cockpit-note' }, t('checkup.fixes')) : null,
                fixes.map((fix) =>
                  h(
                    'div',
                    { key: fix.id, className: 'cockpit-fix' },
                    h(
                      'div',
                      { className: 'cockpit-fixhead' },
                      h('span', { className: 'cockpit-fixlabel' }, fix.label),
                      h(Badge, {
                        text: fix.writes ? t('checkup.fixWrites') : t('checkup.fixSafe'),
                        tone: fix.writes ? 'warn' : 'plain',
                      }),
                    ),
                    h('div', { className: 'cockpit-detail' }, fix.effect),
                  ),
                ),
                row.filePath
                  ? h('div', { className: 'cockpit-note' }, `${t('checkup.location')} ${row.filePath}`)
                  : null,
              )
            : null,
        ),
      )
    }

    // ---- 预设技能组 --------------------------------------------------------
  //
  // 预设 = 「当前这一套技能状态」的快照，存 localStorage，**不写盘**。
  // 真正应用（批量改文件）要用户确认，走 host 的批量路径 —— 见后续版本。
  const PRESET_KEY = 'dsh-skill-cockpit:presets'

  function loadPresets() {
    try {
      const raw = window.localStorage.getItem(PRESET_KEY)
      const list = raw ? JSON.parse(raw) : []
      return Array.isArray(list) ? list : []
    } catch {
      return []
    }
  }

  function savePresets(list) {
    try {
      window.localStorage.setItem(PRESET_KEY, JSON.stringify(list))
    } catch {
      /* 存不进去也不能让面板崩 */
    }
  }

  function PresetsView(props) {
    const skills = props.report && Array.isArray(props.report.skills) ? props.report.skills : []
    const [presets, setPresets] = useState(loadPresets)
    const [name, setName] = useState('')
    const [note, setNote] = useState('')
    const [plan, setPlan] = useState(null)
    const [applied, setApplied] = useState(null)

    // 真正执行：host 逐条 setSkillMode（每条备份 + 原子写），一条失败就停。
    const run = async (preset) => {
      setNote('')
      setApplied(null)
      try {
        const res = await call(`${BASE}/preset/apply`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ preset, cwd: props.cwd }),
        })
        setApplied({ id: preset.id, data: res })
        if (typeof props.onReload === 'function') await props.onReload()
      } catch (err) {
        setNote(t('preset.planFail') + err.message)
      }
    }

    // 只读预览：把预设交给 host 的 /preset/plan 算一遍，一个字都不写。
    const inspect = async (preset) => {
      setNote('')
      try {
        const res = await call(`${BASE}/preset/plan`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ preset, cwd: props.cwd }),
        })
        setPlan({ id: preset.id, data: res })
      } catch (err) {
        setNote(t('preset.planFail') + err.message)
      }
    }

    const capture = () => {
      const items = []
      for (const s of skills) {
        if (!s || s.writable !== true || typeof s.filePath !== 'string') continue
        items.push({ filePath: s.filePath, mode: s.mode || (s.enabled ? 'on' : 'off') })
      }
      if (items.length === 0) {
        setNote(t('preset.none'))
        return
      }
      const label = name.trim() || `${t('preset.defaultName')} ${presets.length + 1}`
      const next = presets.concat([
        { id: `p${Date.now()}`, name: label, scope: 'listed', items },
      ])
      setPresets(next)
      savePresets(next)
      setName('')
      setNote(t('preset.saved', { n: label, c: items.length }))
    }

    const drop = (id) => {
      const next = presets.filter((p) => p.id !== id)
      setPresets(next)
      savePresets(next)
      setNote('')
    }

    return h(
      'div',
      { className: 'cockpit-presets' },
      h('div', { className: 'cockpit-note' }, t('preset.hint')),
      h(
        'div',
        { className: 'cockpit-presetbar' },
        h('input', {
          className: 'cockpit-presetname',
          placeholder: t('preset.namePlaceholder'),
          value: name,
          onChange: (e) => setName(e.target.value),
        }),
        h(
          'button',
          { type: 'button', className: 'cockpit-btn', onClick: capture },
          t('preset.capture'),
        ),
      ),
      note ? h('div', { className: 'cockpit-note' }, note) : null,
      presets.length === 0
        ? h('div', { className: 'cockpit-empty' }, t('preset.empty'))
        : h(
            'div',
            null,
            presets.map((preset) =>
              h(
                'div',
                { key: preset.id, className: 'cockpit-preset' },
                h('span', { className: 'cockpit-name' }, preset.name),
                h(
                  'span',
                  { className: 'cockpit-count' },
                  t('preset.count', { n: (preset.items || []).length }),
                ),
                h(
                  'button',
                  { type: 'button', className: 'cockpit-btn', onClick: () => inspect(preset) },
                  t('preset.plan'),
                ),                h(
                  'button',
                  { type: 'button', className: 'cockpit-btn', onClick: () => run(preset) },
                  t('preset.apply'),
                ),
                h(
                  'button',
                  { type: 'button', className: 'cockpit-btn', onClick: () => drop(preset.id) },
                  t('preset.drop'),
                ),
                applied && applied.id === preset.id && applied.data
                  ? h(
                      'div',
                      { className: 'cockpit-note' },
                      applied.data.failed && applied.data.failed.length > 0
                        ? t('preset.applyFail', {
                            n: (applied.data.applied || []).length + 1,
                            e: applied.data.failed[0].error,
                          })
                        : t('preset.applied', { n: (applied.data.applied || []).length }),
                    )
                  : null,                plan && plan.id === preset.id && plan.data && plan.data.plan
                  ? h(
                      'div',
                      { className: 'cockpit-note' },
                      t('preset.planResult', {
                        w: plan.data.writes || 0,
                        u: plan.data.plan.unchanged || 0,
                        m: (plan.data.plan.missing || []).length,
                        b: (plan.data.plan.blocked || []).length,
                      }),
                    )
                  : null,
              ),
            ),
          ),
    )
  }
  function ChecksView(props) {
      const data = props.data
      if (props.error) {
        return h('div', { style: { color: C.bad, fontSize: '12px', marginTop: '8px' } }, t('checks.error', { error: props.error }))
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

      // 体检 × 用量：把「能加载」和「被用过」接上 —— 只留能加载却一次没调用的。
      // 没有用量数据时整块不渲染：宁可不显示，也不拿 0 冒充证据。
      const usageData = props.usage || null
      const calls = new Map(
        (usageData && Array.isArray(usageData.skills) ? usageData.skills : []).map((s) => [
          s.name,
          s.count || 0,
        ]),
      )
      const installed = Array.isArray(props.skills) ? props.skills.filter((s) => s.writable) : []
      const never = usageData ? installed.filter((s) => !calls.get(s.name)) : []
      const sessions = usageData && typeof usageData.sessions === 'number' ? usageData.sessions : 0

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
          t('checks.summary', { scanned: data.scannedSkills ?? summary.scanned ?? 0, note: data.note || t('checks.noteFallback') }),
        ),
        usageData
          ? h(
              'div',
              { className: 'cockpit-nevercard', 'data-dsh-never-called': '1' },
              h(
                'div',
                { style: { width: '100%', fontSize: '11.5px', color: C.dim, marginBottom: '2px' } },
                t('checks.neverTitle', { count: never.length, sessions }),
              ),
              never.length === 0
                ? h('span', { className: 'cockpit-ok' }, t('checks.neverNone'))
                : never.map((s) =>
                    h(
                      'span',
                      { key: `never-${s.name}`, className: 'cockpit-neverpill' },
                      s.name,
                      h(
                        'button',
                        {
                          type: 'button',
                          title: t('checks.neverDisable'),
                          onClick: () => props.onMode && props.onMode(s, 'off'),
                        },
                        t('checks.neverDisable'),
                      ),
                    ),
                  ),
            )
          : null,
        rows.length === 0
          ? h('div', { className: 'cockpit-ok' }, t('checks.allGood'))
          : h(
              'div',
              { className: 'cockpit-card' },
              rows.map((row, index) =>
                h(CheckRow, { key: `check-${row.kind}-${row.skill}-${index}`, row }),
              ),
            ),
        h('div', { className: 'cockpit-note', style: { borderTop: `0.5px solid ${C.border}`, paddingTop: '8px' } }, NON_FILE_NOTE),
      )
    }

    function Row(props) {
      const { skill, cwd } = props
      const [open, setOpen] = useState(false)
      const curMode = skill.mode || (skill.enabled ? 'on' : 'off')
      const [modeOpen, setModeOpen] = useState(false)
      // 0.6.13：分组菜单不能再交给原生 <select> —— 它的下拉列表由操作系统画，
      // 深色主题下白底 + 继承来的浅灰字，等于"看不见"；点击落在列表上也容易丢事件。
      const [groupOpen, setGroupOpen] = useState(false)
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
      if (bad) chips.push([STATUS_LABEL[skill.status] ? t(STATUS_LABEL[skill.status]) : skill.status, 'bad'])
      if (skill.shadowed) chips.push([t('chip.shadowed'), 'warn'])
      // The source chip is the one badge every row keeps: it answers "which root
      // is this from", which no other line on the row does.
      const sourceText = SOURCE_LABEL[skill.source] ? t(SOURCE_LABEL[skill.source]) : skill.source

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
            h(
                  'span',
                  { className: 'cockpit-mode-wrap' },
                  h(
                    'span',
                    {
                      className: 'cockpit-mode',
                      'data-mode': curMode,
                      'data-dsh-mode': skill.name,
                      title: t('mode.switchTitle'),
                      onClick: () => setModeOpen((v) => !v),
                    },
                    t(MODE_LABEL[curMode]) + ' ▾',
                  ),
                  modeOpen
                    ? h(
                        'span',
                        { className: 'cockpit-mode-menu' },
                        MODE_ORDER.map((m) =>
                          h(
                            'span',
                            {
                              key: m,
                              className: 'cockpit-mode-item' + (m === curMode ? ' is-on' : ''),
                              onClick: (e) => {
                                e.stopPropagation()
                                setModeOpen(false)
                                if (typeof props.onMode === 'function' && m !== curMode) props.onMode(skill, m)
                              },
                            },
                            t(MODE_LABEL[m]),
                          ),
                        ),
                      )
                    : null,
                ),
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
          h(
              'span',
              { className: 'cockpit-seg', 'data-dsh-mode-seg': skill.name },
              MODE_ORDER.map((m) =>
                h(
                  'span',
                  {
                    key: m,
                    className: 'cockpit-seg-item' + (m === curMode ? ' is-on' : ''),
                    title: t(MODE_LABEL[m]),
                    onClick: (e) => {
                      e.stopPropagation()
                      if (typeof props.onMode === 'function' && m !== curMode) props.onMode(skill, m)
                    },
                  },
                  t(MODE_LABEL[m]),
                ),
              ),
            ),
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
                'span',
                { className: 'cockpit-assign-wrap' },
                h(
                  'span',
                  {
                    className: 'cockpit-assign',
                    'data-dsh-assign-open': skill.name,
                    title: t('row.addToGroupTitle'),
                    onClick: (e) => {
                      e.stopPropagation()
                      setGroupOpen((v) => !v)
                    },
                  },
                  t('row.addToGroup') + ' ▾',
                ),
                groupOpen
                  ? h(
                      'span',
                      { className: 'cockpit-assign-menu', 'data-dsh-assign-menu': skill.name },
                      props.groups.map((g) =>
                        h(
                          'span',
                          {
                            key: g.id,
                            className: 'cockpit-assign-item',
                            'data-dsh-assign-pick': g.id,
                            onClick: (e) => {
                              e.stopPropagation()
                              setGroupOpen(false)
                              props.onAssign(skill.name, g.id, true)
                            },
                          },
                          groupText(g),
                        ),
                      ),
                    )
                  : null,
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

      // 2026-10-21 户主：31 个技能挤在一列里"找不好找" —— 左栏加个搜索框。
      // 只筛左栏候选卡（拖拽来源）；右栏的分组内容不动 —— 那是结果，不是候选。
      const groupQueryText = String(props.groupQuery || '').trim().toLowerCase()
      const visibleSkills =
        groupQueryText === ''
          ? props.skills
          : props.skills.filter(
              (s) => (s.name + ' ' + String(s.description || '')).toLowerCase().indexOf(groupQueryText) !== -1,
            )

      return h(
        'div',
        { 'data-dsh-view-panel': 'groups', className: 'cockpit-section' },
        h(
          'div',
          { className: 'cockpit-newgroup' },
          h('input', {
            className: 'cockpit-input',
            value: props.newGroupLabel,
            placeholder: t('groups.boardPlaceholder'),
            onChange: (e) => props.setNewGroupLabel(e.target.value),
            onKeyDown: (e) => {
              if (e.key === 'Enter') props.onAddGroup()
            },
          }),
          h('button', { className: 'cockpit-btn', onClick: props.onAddGroup }, t('groups.create')),
          h('span', { className: 'cockpit-note' }, t('groups.boardNote')),
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
              h('span', { className: 'cockpit-groupname' }, t('groups.allSkills')),
              h(
                'span',
                { className: 'cockpit-count' },
                groupQueryText === ''
                  ? t('groups.count', { count: props.skills.length })
                  : `${visibleSkills.length} / ${props.skills.length}`,
              ),
            ),
            h('input', {
              className: 'cockpit-input cockpit-pane-search',
              type: 'search',
              'data-dsh-group-search': '1',
              value: props.groupQuery || '',
              placeholder: t('groups.searchPlaceholder'),
              'aria-label': t('groups.searchPlaceholder'),
              onChange: (e) => props.onGroupQuery(e.target.value),
            }),
            h(
              'div',
              { className: 'cockpit-pane-list' },
              visibleSkills.length === 0
                ? h('span', { className: 'cockpit-hint' }, t('groups.searchNone'))
                : visibleSkills.map((skill) =>
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
              // 整组也走四档：只有全组同档时那一档才亮；混着就一个都不亮（不假装）。
              const memberSkills = members.map((m) => byName[m.name]).filter(Boolean)
              const modes = memberSkills.map((s) => s.mode || (s.enabled ? 'on' : 'off'))
              const groupMode =
                modes.length > 0 && modes.every((m) => m === modes[0]) ? modes[0] : null
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
                        title: t('groups.renameTitle'),
                      })
                    : h('span', { className: 'cockpit-groupname' }, groupText(group)),
                  h('span', { className: 'cockpit-count' }, `${members.length}`),
                  h('span', { style: { flex: '1 1 auto' } }),
                  h(
                    'div',
                    { className: 'cockpit-seg', title: t('groups.modeTitle') },
                    MODE_ORDER.map((m) =>
                      h(
                        'span',
                        {
                          key: `gmode-${group.id}-${m}`,
                          className: 'cockpit-seg-item' + (groupMode === m ? ' is-on' : ''),
                          'data-group-mode': m,
                          onClick: () => props.onGroupMode(memberSkills, m),
                        },
                        t(MODE_LABEL[m]),
                      ),
                    ),
                  ),
                  group.custom
                    ? h(
                        'button',
                        {
                          className: 'cockpit-btn',
                          onClick: () => props.onRemoveGroup(group.id),
                          title: t('groups.deleteShortTitle'),
                        },
                        t('groups.delete'),
                      )
                    : null,
                ),
                h(
                  'div',
                  { className: 'cockpit-pane-grid' },
                  members.length === 0
                    ? h('span', { className: 'cockpit-hint' }, t('groups.dropHint'))
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
                                    title: t('groups.removeTitle'),
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
      // 分组状态来自模块级共享快照（见 writeGroupStore 上方），不是每个 mount 各读一份。
      const [groupStateRaw, setGroupStateRaw] = useState(groupSnapshot)
      useEffect(() => subscribeGroup(setGroupStateRaw), [])
      // 本面板的身份：广播时用它区分「是我改的」还是「别处改的」。
      const mountToken = useMemo(() => ({}), [])
      // 归一化：localStorage 损坏、或渲染环境没有真实 useState 时一律退化成空状态，
      // 绝不让分组数据把整页打挂。
      const groupState =
        groupStateRaw && Array.isArray(groupStateRaw.groups) && groupStateRaw.assign
          ? groupStateRaw
          : { groups: [], assign: {} }
      const [newGroupLabel, setNewGroupLabel] = useState('')
      // 分组页左栏的搜索词（31 个技能一列排下来找不动）—— 放在最后一位，别打乱既有 hook 序号。
      const [groupQuery, setGroupQuery] = useState('')
      const load = useCallback(async () => {
        setBusy(true)
        setError(null)
        try {
          const url = cwd ? `${BASE}/skills?cwd=${encodeURIComponent(cwd)}` : `${BASE}/skills`
          const data = await call(url)
          setReport(data)
          // 体检摘要跟着列表一起拉：体检条要回答的是"有几个问题"，
          // 只靠清单统计（多少条技能）答不了。拉不到就当没有体检结果，不影响列表。
          try {
            const checksUrl = `${BASE}/checks${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''}`
            setChecksData(await call(checksUrl))
          } catch {
            /* 体检失败不阻断列表 */
          }
          // Returned so a caller can PROVE the effect of its own write: the
          // toggle claims "the model no longer sees it", and this is where
          // that claim gets checked against a fresh rescan instead of asserted.
          return data
        } catch (err) {
          setError(err.message)
          return null
        } finally {
          setBusy(false)
        }
      }, [cwd])

      // The layout mounts this page only while the row is selected, so mount
      // IS the visible state — there is no `visible` prop on this seat.
      useEffect(() => {
        load()
      }, [load])

      // 另一处面板改了开关/四态 → 这里重拉 /skills；自己发的通知自己跳过（发起方已经在等
      // load() 的返回值做证据，不该再拉一遍）。
      useEffect(
        () =>
          subscribeSkills((origin) => {
            if (origin !== mountToken) load()
          }),
        [load, mountToken],
      )

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
        ;(async () => {
          try {
            if (view === 'checks') {
              const data = await call(`${BASE}/checks${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''}`)
              if (cancelled) return
              setChecksData(data)
              setChecksError(null)
              // 体检要拿用量来对「能加载但没被调用」——同一屏两个数据源。
              const usageData = await call(`${BASE}/usage`)
              if (cancelled) return
              setUsage(usageData)
              setUsageError(null)
              return
            }
            const data = await call(`${BASE}/usage`)
            if (cancelled) return
            setUsage(data)
            setUsageError(null)
          } catch (err) {
            if (cancelled) return
            if (view === 'checks') setChecksError(err.message)
            else setUsageError(err.message)
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
            const beforeVis =
              report && typeof report.visibleToModel === 'number' ? report.visibleToModel : null
            const fresh = await load()
            // 告诉另一处面板（右栏 / 主界面）重拉：两处显示同一份磁盘事实。
            emitSkillsChanged(mountToken)
            const afterVis =
              fresh && typeof fresh.visibleToModel === 'number' ? fresh.visibleToModel : null
            // The claim "the model no longer sees it" is CHECKED, not asserted: compare
            // the model-visible count before and after a fresh rescan.
            const proof =
              beforeVis !== null && afterVis !== null && beforeVis !== afterVis
                ? ` | ${t('notify.proof', { before: beforeVis, after: afterVis, scanned: (fresh && fresh.totalEntries) || 0 })}`
                : ''
            setNotice(
              `${target.enabled ? t('notify.disabled') : t('notify.restored')} ${target.name} | ` +
                (target.enabled ? t('notify.disabledHow') : t('notify.restoredHow')) +
                proof,
            )
          } catch (err) {
            setError(err.message)
          } finally {
            setBusy(false)
          }
        },
        [cwd, load, report],      )

      const skills = report ? report.skills : []
      // 体检条：先说"有几个问题"，再说清单统计。
      // 只报"多少条技能"是在答另一个问题，不是体检。
      const checkSummary = checksData && checksData.summary ? checksData.summary : null
      const issueCount = checkSummary
        ? (checkSummary.shadowed || 0) +
          (checkSummary.shortDescription || 0) +
          (checkSummary.dirNameMismatch || 0) +
          (checkSummary.emptyBody || 0)
        : null
      const fixableCount =
        checksData && Array.isArray(checksData.checks)
          ? checksData.checks.filter((c) => c && Array.isArray(c.fixes) && c.fixes.length > 0).length
          : 0
      const bannerMain =
        issueCount === null
          ? t('checkup.bannerSub', {
              total: report ? report.totalEntries ?? 0 : 0,
              visible: report ? report.visibleToModel ?? 0 : 0,
            })
          : issueCount === 0
            ? t('checkup.bannerOk', { total: report ? report.totalEntries ?? 0 : 0 })
            : t('checkup.bannerBad', { issues: issueCount, fixable: fixableCount })
      const bannerText =
        issueCount === null
          ? bannerMain
          : bannerMain +
            '\n' +
            t('checkup.bannerSub', {
              total: report ? report.totalEntries ?? 0 : 0,
              visible: report ? report.visibleToModel ?? 0 : 0,
            })
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
        writeGroupStore((prev) => {
          const assign = Object.assign({}, prev.assign)
          const list = Array.isArray(assign[groupId]) ? assign[groupId].slice() : []
          const idx = list.indexOf(skillName)
          if (add && idx === -1) list.push(skillName)
          if (!add && idx !== -1) list.splice(idx, 1)
          if (list.length === 0) delete assign[groupId]
          else assign[groupId] = list
          return { groups: prev.groups, assign }
        })
      }, [])

      const addGroup = useCallback(() => {
        const label = newGroupLabel.trim()
        if (label === '') return
        writeGroupStore((prev) => {
          const id = 'u' + Date.now().toString(36)
          return { groups: prev.groups.concat([{ id, label }]), assign: prev.assign }
        })
        setNewGroupLabel('')
      }, [newGroupLabel])

      const removeGroup = useCallback((groupId) => {
        writeGroupStore((prev) => {
          const assign = Object.assign({}, prev.assign)
          delete assign[groupId]
          return { groups: prev.groups.filter((g) => g.id !== groupId), assign }
        })
      }, [])

      const renameGroup = useCallback((groupId, label) => {
        writeGroupStore((prev) => ({
          groups: prev.groups.map((g) => (g.id === groupId ? { id: g.id, label } : g)),
          assign: prev.assign,
        }))
      }, [])
      /** 整组开/关：逐个走同一个 /toggle（每个都只改入口文件名）。 */
      // 整组开/停：逐个走同一个 /toggle（每个都只改入口文件名）。
      // 关键：**任何情况下都要给反馈** —— 之前"没有可写目标就静默 return"，
      // 表现就是"点了没反应"。
      const applyGroupToggle = useCallback(
        async (members, disable) => {
          const action = disable ? t('action.disable') : t('action.enable')
          // 要停用 ⇒ 目标是"当前启用"的；要启用 ⇒ 目标是"当前停用"的。
          // 这里原来写成 `s.enabled === !disable`，方向正好反了 ⇒ want 永远为空 ⇒
          // 无论点哪个都提示"已经全部…了，无需操作"。
          const want = members.filter((s) => Boolean(s.enabled) === Boolean(disable))
          if (want.length === 0) {
            setNotice(t('groupToggle.allDone', { action }))
            return
          }
          const writable = want.filter((s) => s.writable)
          const skipped = want.length - writable.length
          if (writable.length === 0) {
            setError(t('groupToggle.readonly', { count: skipped, action }))
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
            t('groupToggle.resultHead', { action, ok }) +
              (skipped ? t('groupToggle.resultSkipped', { count: skipped }) : '') +
              (failed ? t('groupToggle.resultFailed', { count: failed }) : ''),
          )
          if (failed) setError(t('groupToggle.firstError', { count: failed, error: firstError }))
          await load()
          emitSkillsChanged(mountToken)
          setBusy(false)
        },
        [cwd, load, mountToken],
      )

      // 四态切换：走 host 的 /mode（同一道可写根闸），成功后复扫一次并出示可见数变化。
      // 与 applyToggle 一样，证据只在数字真的变了时才显示 —— 不凑。
      // 一组人是不是同一档：全同 ⇒ 返回那一档；混着 ⇒ null（就一个都不亮，不假装）。
      const groupUniformMode = (list) => {
        if (!Array.isArray(list) || list.length === 0) return null
        const modeOf = (s) => s.mode || (s.enabled ? 'on' : 'off')
        const first = modeOf(list[0])
        return list.every((s) => modeOf(s) === first) ? first : null
      }

      // 整组四态：把这组全部设成同一档。逐条走 /mode（每条自带备份 + 原子写），
      // 全部走完只复扫一次 —— 5 个技能刷 5 次列表既慢又闪。
      const applyGroupMode = useCallback(
        async (members, mode) => {
          const label = t(MODE_LABEL[mode])
          const want = members.filter(
            (s) => s.writable && (s.mode || (s.enabled ? 'on' : 'off')) !== mode,
          )
          if (want.length === 0) {
            setNotice(t('groupMode.allDone', { label }))
            return
          }
          setBusy(true)
          setError(null)
          let ok = 0
          let firstError = ''
          for (const skill of want) {
            try {
              await call(`${BASE}/mode`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ filePath: skill.filePath, mode, cwd }),
              })
              ok += 1
            } catch (err) {
              if (firstError === '') firstError = err.message
              break
            }
          }
          await load()
          emitSkillsChanged(mountToken)
          setBusy(false)
          if (firstError !== '') setError(firstError)
          else setNotice(t('groupMode.done', { count: ok, label }))
        },
        [cwd, load, mountToken],
      )

      const applyMode = useCallback(
        async (target, mode) => {
          setBusy(true)
          setError(null)
          try {
            const result = await call(`${BASE}/mode`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ filePath: target.filePath, mode, cwd }),
            })
            const before =
              report && typeof report.visibleToModel === 'number' ? report.visibleToModel : null
            const fresh = await load()
            emitSkillsChanged(mountToken)
            const after =
              fresh && typeof fresh.visibleToModel === 'number' ? fresh.visibleToModel : null
            const proof =
              before !== null && after !== null && before !== after
                ? ' · ' +
                  t('notify.proof', { before, after, scanned: (fresh && fresh.totalEntries) || 0 })
                : ''
            const backup =
              result && typeof result.backup === 'string'
                ? ` · ${t('notify.backup')} ${result.backup}`
                : ''
            setNotice(
              `${t('notify.modeSet')} ${target.name} → ${t(MODE_LABEL[mode])}${backup}${proof}`,
            )
          } catch (err) {
            setError(err.message)
          } finally {
            setBusy(false)
          }
        },
        [cwd, load, report],
      )

      const head = report
        ? t('roots.summary', { total: report.summary.totalEntries, enabled: report.summary.enabled, disabled: report.summary.disabled, visible: report.summary.visibleToModel }) +
          (report.summary.dropped ? t('roots.dropped', { count: report.summary.dropped }) : '')
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
          report
            ? h(
                'div',
                {
                  className: 'cockpit-checkup',
                  'data-dsh-checkup': '1',
                  title: t('checkup.bannerHint'),
                  onClick: () => setView('checks'),
                },
                h(
                  'span',
                  null,
                  bannerText,
                ),
                h('span', { className: 'cockpit-checkup-go' }, t('checkup.bannerGo')),
              )
            : null,
        notice ? h('div', { className: 'cockpit-ok' }, `✓ ${notice}`) : null,
        // 一条工具条：搜索（占满剩余）+ 新建分组（紧凑）。说明文字收进 title —— 三行堆叠是上一版最难看的点。
        h(
          'div',
          { className: 'cockpit-toolbar' },
          h(
            'div',
            { className: 'cockpit-search' },
            h('input', {
              className: 'cockpit-input',
              type: 'search',
              value: query,
              placeholder: t('search.placeholder'),
              'aria-label': t('search.placeholder'),
              onChange: (e) => setQuery(e.target.value),
            }),
          ),
          h(
            'div',
            { className: 'cockpit-newgroup', title: t('groups.localOnly') },
            h('input', {
              className: 'cockpit-input',
              value: newGroupLabel,
              placeholder: t('groups.newPlaceholder'),
              'aria-label': t('groups.newPlaceholder'),
              onChange: (e) => setNewGroupLabel(e.target.value),
              onKeyDown: (e) => {
                if (e.key === 'Enter') addGroup()
              },
            }),
            h('button', { className: 'cockpit-btn cockpit-btn-solid', onClick: addGroup }, t('groups.create')),
          ),
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
                    'div',
                    {
                      className: 'cockpit-seg',
                      'data-dsh-group-switch': gid,
                      title: t('groups.modeTitle'),
                    },
                    MODE_ORDER.map((m) =>
                      h(
                        'span',
                        {
                          key: `gseg-${gid}-${m}`,
                          className:
                            'cockpit-seg-item' +
                            (groupUniformMode(members) === m ? ' is-on' : ''),
                          'data-group-mode': m,
                          onClick: () => {
                            if (busy) return
                            applyGroupMode(members, m)
                          },
                        },
                        t(MODE_LABEL[m]),
                      ),
                    ),
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
          onMode: applyMode,
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
                  t('roots.line', {
                    source: root.source,
                    rank: root.rank,
                    state: root.path === null
                      ? t('roots.notMounted')
                      : root.exists
                        ? t('roots.counts', { skills: root.skillCount, enabled: root.enabledCount, disabled: root.disabledCount })
                        : t('roots.missing'),
                    writable: root.writable ? t('roots.writable') : t('roots.readonly'),
                    note: root.note ? t('roots.noteSuffix', { note: root.note }) : '',
                  }),
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
                  ? h('div', { style: { color: C.dim, fontSize: '12px' } }, hits.note || t('index.noMatch', { count: hits.total || 0 }))
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
              h('div', { style: { fontSize: '11px', color: C.dim, marginTop: '4px' } }, hits.path ? t('usage.index', { path: hits.path }) : t('index.notConfigured')),
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
              onGroupMode: applyGroupMode,
              newGroupLabel,
              setNewGroupLabel,
              groupQuery,
              onGroupQuery: setGroupQuery,
            })
          : null,
        view === 'usage' ? h(UsageView, { usage, error: usageError, report }) : null,
        view === 'checks'
          ? h(ChecksView, {
              data: checksData,
              error: checksError,
              usage,
              skills: (report && report.skills) || skills,
              onMode: applyMode,
            })
          : null,
        view === 'presets' ? h(PresetsView, { report, cwd, onReload: load }) : null,
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
