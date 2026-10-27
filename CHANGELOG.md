## 1.3.2 — 2026-10-27

### 修复 1.3.1 的两个回归

- 分组页组头数字与列表页对不上（列表 7、分组框 5）：分组页成员改成与列表页同一套口径（`tagsOf`，含关键词归类与手动归属），不再只读硬编码名单。
- 分组页左上角一片空白：顶部「共 N / 已归组 / 未归组」那行是网格的第一个子元素，占掉了一整格；改成整行跨列。

## 1.3.1 — 2026-10-27

### 修复：分组页数字和列表对不上

- 分组页顶部新增**实数口径条**：`共 N 个技能 · 已归组 M · 未归组 K`，并注明「同一技能可属多个组，各组数字相加会多于总数」。
- 组头数字改成只数**现存**技能；分组里记着、但本机已删掉的旧名字单独标 `N 个已不在本机`，不再把数字撑大。

### 新增：英文技能的中文摘要（只改显示）

- 列表里描述是英文的技能，会显示一行中文摘要；没有的可以点「补中文」自己填。
- 摘要只存在本机浏览器（`localStorage`），**从不写进任何 SKILL.md**；内建 12 条常用英文技能的中文摘要。
- 中英词典同步补齐；自测 15/15 通过。

## 1.3.0 — 2026-10-27

### 新增：自动加载搬进主工具栏 + 每行「必用」

- 自动加载控件从大卡片改成**工具栏一条**：开关（已开/已关）+ 严格/标准/宽松三档小按钮，页面顶部不再占一大块。
- 每个技能行新增**「必用」(pin) 按钮**：不看相关度，直接排进每轮注入最前；点一下切换，状态读自 `autoload.json` 的 `pinned`。
- 删掉「测一下命中率」按钮（同样输入每次结果一样，没有信息量）；评测仍保留为 `skill_autoload action=eval`。

### 修复：点「新建技能」整页白屏（从 0.6.38 起就存在）

- 根因：新建表单（ManageBox）里用了只在主面板（SkillPanel）作用域内定义的 `TPL_LABEL`，渲染期 `ReferenceError`，React 把整页卸掉。
- 修法：把 `TPL_LABEL` 提到两者共用的工厂作用域。
- 回归防线：新增**渲染冒烟**测试（迷你 React 真跑组件 → 点「新建技能」→ 断言创建表单渲染出来），这类"单测全绿但整页白"以后会在提交前被拦住。

### 文档

- 中英 README 补全自动加载：三档的实际阈值（严格 4.0/2 词/4KB · 标准 2.5/1 词/8KB · 宽松 1.5/1 词/16KB）、单轮 3 个与 24KB 上限、必用语义、**开启的实际代价**（token、误注入 1/10、recall 7/10、互相挤占）与建议用法。

## 1.2.0 — 2026-10-26

### 新增：让「开了就一定用」变得可测、可控

- **`skill_autoload action=eval`**：跑内置 20 条查询集（10 应命中 / 10 不应命中），返回 recall 与误注入率，并逐条列出漏判；期望技能未安装的条目标 `missing`，不计入分母。
- **`skill_autoload action=pin` / `unpin`**：本场必用——指定技能不看相关度、直接排进每轮注入最前（仍受单技能与总预算约束），提醒里标明「本场必用（用户已指定）」。
- 设置文件 `~/.dsh/skill-cockpit/autoload.json` 新增字段 `pinned`。

### 说明

宿主没有公开的「插件往系统提示注入」通道时，100% 强制做不到；本版把口径钉在**高置信触发**：可测量（eval）+ 可兜底（pin）。

## 1.1.2 — 2026-10-25

### 修复：`skill_autoload` 工具在真机上根本没注册

- 现象：1.1.0/1.1.1 文档都写着「用 `skill_autoload` 一句话开关自动加载」，但真机工具清单里查不到它（`skill_panel` 正常）。
- 根因：`ToolDefinition` 必须带 `output: { schema, render }`；`skill_autoload` 少了这一段，`ctx.tools.register()` 抛错，而外层 `try/catch` 只打一行日志就吞掉 —— 表现就是「工具没出现」。
- 修法：补上 `output`（与 `skill_panel` 同形），并加源码级回归断言，防止再漏。

## 1.1.1 — 2026-10-25

### 修复：小技能库下「词对上了也不触发」

- 从 npm 干净安装（只装 1 个技能）实测到：IDF 按真实语料算，df≈n 时权重被压到接近 0，
  于是「Excel 表格公式」这种明明命中的查询一条都选不出来。
- 现在 IDF 分母取 `max(20, 技能数)`、权重下限 1.0：装三五个技能和装三十个一样好触发。
- 新增回归测试（1 个 / 3 个技能的语料必须命中，且无关问题仍不误注入）。

## 1.1.0 — 2026-10-25

### 新增：开 = 自动加载（本版本的主功能）

把技能拨到「全开」后，相关任务出现时，插件会在这一轮的对话里**直接放进技能正文**，
模型不用再想起「我该调 skill_panel 读一下」。用户侧只有一个动作：把技能拨到全开。

- `agent/pre-step` 钩子：每轮取用户原话 → 本地匹配 → 往本轮消息里插一条 `<system-reminder>`
  （构造方式为「克隆本轮真实用户消息再换文本」，不依赖宿主内部消息类型的字段名，结构天然合法）。
- 匹配引擎为纯函数（`lib/autoload.js`）：英文分词 + 中文二元组 + IDF 加权 + 中英领域词桥接
  （表格→excel、幻灯片→powerpoint、文档→word…），三档灵敏度：严格 4KB / 标准 8KB / 宽松 16KB，
  单会话预算 24KB，同一技能同会话只注入一次，`</system-reminder>` 一律转义。
- 设置存 `~/.dsh/skill-cockpit/autoload.json`；**默认关闭**（装上升级不改变你现有对话行为）。
- `autoload.probe` 开关可把每轮"看见了什么"写到 `prestep-probe.json`，用于排查"为什么没生效"。
- 任何异常都只跳过这一轮，绝不影响正常对话（整段 try/catch + 逐层兜底）。

### 自测

- 新增两套：`test/run-autoload.mjs`（20 条查询集：10 应命中 / 10 不应命中，实测召回 10/10、
  误注入 0/10）与 `test/run-autoload-wire.mjs`（设置读写、正文 mtime 缓存、注入位置、去重）。
- 套件总数 12 → 14。

## 0.12.2 — 2026-10-24

- **文档**：README 顶部过期状态（v0.6.8 / npm 0.2.3）改成 0.12.2 实况；新增「安装」小节（npm i + bundle 挂载）；截图改绝对地址，npm 页也能显示。
- **元数据**：`package.json` 补 `dsh.manifestVersion: 1`（与同生态插件一致，便于市场索引识别）。
- 无代码行为变更。

## 0.12.1 — 2026-10-24

- **修**：工具改名 `skill` → `skill_panel`。0.12.0 用 `skill` 与宿主自带的同名工具撞车，注册被吞、列表里看不到（实测 `Tools/listTools` 只有内置那个）。
- 注册后补一行启动日志 `[skill-cockpit] tool registered: skill_panel`，以后再撞名一眼可见。

## 0.12.0 — 2026-10-24

- **给 dsh 的工具接口**：注册单个工具 `skill`（action 枚举 11 个：list / read / create / update / delete / toggle / repair / backup / trash_list / trash_restore / trash_purge）。以后「把 X 停掉」「新建一个 Y 技能」这类话，dsh 直接调工具改磁盘，不用点面板。
- 与任务板同一套路：工具由插件注册（`ctx.tools.register`），**不需要 SKILL.md**；`inject` 从空数组改为 `["tools"]`（先声明再使用，不做探测）。
- `delete` / `trash_purge` 必须带 `confirm: true`，且删除前整份进回收站；只写用户级技能根，项目级只读。
- 顺手修：同一秒内连删同名技能会撞回收站目录名，现在顺延 `-2`、`-3`，不覆盖也不报错。

## 0.11.3 — 2026-10-24

- **删掉「检查更新 / 一键更新」整块功能**：本机 32 个技能里 30 个没有任何来源记录（无 `.git`、无 `upstreams.json`、`skills-lock.json` 也对不上），且多数被本机改过（中文化 + `SKILL.md.bak`），"逐字节比对"只会全报有更新、一键覆盖本地改动。功能无价值且有风险，按户主决定删除。
- 删除：`lib/update.js`、`bin/check-updates.mjs`、`POST /update/check`、`POST /update/apply`、`GET /update/report`（30 → 27 条路由）、面板工具栏的更新块与全部 `update.*` 词条。
- 保留：更新时旧版的暂存残壳仍在「回收站」列出并可一键彻底删除（`lib/parked.js`）。
- 回收站「彻底删除」：先递归去只读 + 3 轮重试（0.11.2），失败改报人话。

# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project intends to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.11.1

> 2026-10-24 更正：本机计划任务 `dsh-skill-cockpit-update-check` 实测未按时跑成（只登录时运行 + 电池不启动，上次结果 0x800710E0），按户主决定已删除。`bin/check-updates.mjs` 与 `GET /update/report` 保留，可手动跑或以后改别的触发方式。


### Added
- **无会话自动检查**：`bin/check-updates.mjs` —— 独立 Node 脚本，不依赖 dsh、不调用模型。
  由 Windows 计划任务每天跑一次，把结果写进 `<DSH home>/skill-cockpit/update-report.json`。
- 面板打开时通过 `GET /update/report` 读这份报告（不联网、秒回），显示「上次后台检查：时间 · N 个有更新」。
- 本机已登记计划任务 `dsh-skill-cockpit-update-check`（每天 03:30）。

### Notes
- 比对的成本：纯 CPU + 网络，0 token、0 元；计划任务跑完即退。
- 改时间：`schtasks /change /tn dsh-skill-cockpit-update-check /st 09:00`；删除：`/delete`。

## 0.11.0

### Added
- **上游更新**：技能面板新增「检查更新 / 更新」。
  - 检查：按技能目录找到它的上游（所在 git 工作树的 origin + 相对路径，或 `<DSH home>/skill-cockpit/upstreams.json` 里配的 {url, path}），
    用 `git clone --filter=blob:none --no-checkout --depth 1` + `sparse-checkout` 只拉这个技能的文件，
    与装着的目录逐字节比对：一样 = 已最新，不一样 = 有更新。
  - 更新：先把旧目录整份复制进回收站，再用上游那份替换；已是最新则什么都不做。
  - 状态：有更新 / 已更新 / 已最新 / 无上游 / 出错（网络失败报原文，绝不当成「已最新」）。
  - 代理：git 配了「没人监听的本机代理」导致连接失败时，自动直连重试一次。
- 新路由：`POST /__dsh-skill-panel/update/check`、`POST /__dsh-skill-panel/update/apply`（共 29 条）。
- `upstreams.json`（可选，放 `<DSH home>/skill-cockpit/`）：给不在 git 仓库里的技能手填上游地址。

### Notes
- 一次检查会按仓库各克隆一次（只下提交与树），实测单个仓库约 1–2 分钟；之后同一批技能共用这次克隆。
- 只读上游，绝不改动别人的工作树；替换前备份走既有回收站。

## 0.10.4

- 后备库排版重做：按名单里的标题分组（组名 + 条数，组间分隔线），条目改两行式——第一行名字 + 体积，第二行能力说明，第三行灰色来源（超长省略，悬停看全），右侧固定「装回」按钮。
- 顶部显示「共 N 条 · M 组」；搜索同时匹配组名。

## 0.10.3

- 修：本机覆盖 `local.json` 只按 `dshHome` 找，宿主把 dshHome 配成别处时整份配置被静默忽略（表现：后备库一直显示默认空名单）。现在同时找 `<dshHome>/skill-cockpit/local.json` 与 `~/.dsh/skill-cockpit/local.json`。
- 真机验证：`/vault/list` 返回 total=190、exists=true。

## 0.10.2

- A 版收口：本机没装 git 时，点「恢复」给出人话提示（「先装 Git 再点恢复，或把来源改成本机目录」），不再是 ENOENT 堆栈。
- README 补 `reserveListPath` 默认位置与改法（后备名单存哪、怎么换成自己的清单）。

## 0.10.1

- 「恢复」不再要求本机留副本：来源是 git 地址（https / ssh / file / 以 .git 结尾）就 `git clone --depth 1` 到临时目录再装进技能根；是本机目录才复制；两者都不是就明确拒绝。临时目录无论成败都清理。
- 实测：本地 git 仓库 file:// 来源 → clone → 装回成功，无残留临时目录。

## 0.10.0

- **重做后备库语义**：后备库 = 一份名单（名字 / 一句话能力 / 来源 / 体积 / 备注），不是技能目录。
  「存进后备库」= 跟普通删除完全一样（复制进回收站后删除），只多写一行名单。
  「恢复」= 按名单里的「来源」装回来；来源是本机目录才复制，不是本机目录（仓库名/网址）明确拒绝 —— 面板不联网。
- 名单路径可配 `reserveListPath`，默认 `<DSH home>/skill-panel/后备库.md`；名单不能落在技能根内。
- 0.9.2 的「后备名单」区块并入本页，不再分两块。

## 0.9.2

- 体检：`~/.agents/skills`（跨工具可选根）目录不存在时不再报「技能根不存在」——根上标 `optional`，诊断层跳过可选根；目录一旦存在照常纳入。
- 后备库页新增「后备名单」区块：读 `undeclaredIndexPath` 指向的未安装技能索引，按标题分组、可搜索、显示来源与体积；只读展示，面板不下载、不写入。
- 修复 0.9.1 只改了可写根、体检仍报缺失的问题（两条根列表不是同一处）。
## [0.9.1] - 2026-10-23

### Fixed

- `~/.agents/skills` 改为**可选根**：目录不存在时不再列出，体检也不会再报「技能根不存在」；目录存在则自动纳入。新安装不再出现无意义的红字提示。

## [0.9.0] - 2026-10-23

### Changed

- **默认值去本地体系化（对外版 A）**：回收站默认改到 `<DSH home>/skill-panel/trash`，不再写死 `D:\回收站`；界面文案不再显示本机路径。
- **本机覆盖（B 专用，不进 npm 包）**：`<DSH home>/skill-cockpit/local.json` 可覆盖 `trashRoot`、`reserveDir` 等；B 用它保留自己的体系，A 完全不需要它。
- 回收站三个路由改为用服务端配置的路径，不再相信客户端传来的路径。

## [0.7.0] - 2026-10-23

### Added

- **后备库（reserve vault）**：技能的长期停放区，跟回收站分工 —— 回收站管「刚删、想撤销」，后备库管「暂时不用、以后还要」。
  - 删除确认框多一个勾选「存进后备库」：勾了就整目录移进后备库（不是复制到回收站），并在库里追加一行 `_后备库索引.md`。
  - 新页签「后备库」（回收站右边）：按分类目录分组、可搜索、每行「装回」一键复制回技能根；装回不删库里那份，可反复装。
  - 位置默认 `<DSH home>/skill-vault`，可用 `reserveDir` 配置改到自己的资料盘；放在任何技能根之内会被拒绝（否则会被当成已安装技能扫到）。
  - 目录结构就是分类：`<后备库>/<分类>/<技能名>/SKILL.md`；直接放根下算「未分类」。

### Tests

- 客户端 95/95；全套 12/12；`lib/vault.js` 移动→列出→装回→拒绝覆盖 全链路实测通过。

## [0.6.43] - 2026-10-23

### Fixed

- 偏好条里的两个下拉底部被卡片裁掉（卡片用 `overflow:hidden` 裁圆角，顺手把下拉和聚焦环一起裁了）。含下拉的卡片改为 `overflow:visible`，偏好条内的下拉再压扁一点，一行放得下。

### Tests

- Client suite 95/95。

## [0.6.42] - 2026-10-23

### Fixed

- 体检页的「一键修」只画在**真能修**的条目上（描述过短 / 目录名≠技能名 / 入口缺字段）。「正文疑似为空」「跨根重名」原本也画了按钮，点了只会"没反应"—— 现在改为一句提示「一键修只补 name / 描述，不编正文」。修不修得了，按钮说了算。

### Tests

- Client suite 95/95。

## [0.6.41] - 2026-10-23

### Fixed

- 体检页每个可修的条目现在直接带「一键修」按钮 —— 之前只有列表页有，体检页只给文字建议，等于"看得到、点不到"。
- 「技能根不存在」不再一律当故障：只要还有别的根扫到技能，这一条按提示显示（不标黄），并注明「该根下 0 个技能，不影响其它根」。这一类不是技能文件问题，没有一键修，改为「复制路径」，方便去资源管理器把目录建出来。

### Tests

- Client suite 95/95（新增两条断言：体检行的一键修钩子、空根降级文案）。

## [0.6.40] - 2026-10-23

### Fixed

- **Dropdowns are drawn by the panel, not the operating system.** Six native `<select>` elements
  remained — sort, jump-to-skill, preferences (usage window / default sort), batch group and the
  new-skill template. The OS paints that popup itself, so on a dark theme it appeared as a light
  list with the inherited light-grey text: the options could not be read. All six now share one
  self-drawn `Picker`: explicit background and text colour from theme tokens (with fallbacks),
  hover and selected states, Esc / click-outside to close, and clicking the current option does
  not fire the handler again.
- **Long lists scroll instead of covering the panel.** The menu is capped at 248px with its own
  scrollbar. The jump-to-skill picker (40+ skills) also gained its own filter box and opens
  right-aligned to its trigger, so it stays inside the panel.

### Docs

- README (both languages) documents the optional **reserve skill vault**: a plain folder of
  uninstalled skills plus one markdown table, indexed read-only by the panel, installed only when
  needed through the existing import flow.

### Tests

- Client suite 93/93. Four new assertions keep the panel free of native `<select>`, keep all six
  dropdowns on the shared `Picker`, and pin the menu's own background / text colour plus its
  max-height.

## [0.6.39] - 2026-10-23

Local-only skill cockpit: every lifecycle action now happens inside the panel, with no MCP
management and no network market.

### Added

- **One-click repair.** Fixes only what it can prove: a missing `name`, a `name` that differs from
  its folder, an unquoted `:` inside `description`, and a missing or too-short description taken
  from the first usable body line. It copies the file to `.bak-<stamp>` first and refuses instead
  of inventing content when the frontmatter or body is unusable. Idempotent.
- **Recycle bin.** Deletes move the whole folder into `D:\\回收站\\技能面板删除` before anything is
  removed. The panel lists, previews, restores and purges those copies; purge only ever touches the
  trash copy, never the live skill.
- **Batch actions.** Multi-select rows, then enable / disable / delete (with an inline second
  confirmation) / assign to a group / clear.
- **Sort and filter.** Name, source, status and usage; the usage sort loads the usage index lazily.
- **Preferences.** Usage window, default sort and the destructive-action confirmation are stored in
  `localStorage` and survive reloads.
- **Local backup.** One skill or all of them, copied into `D:\\回收站\\技能面板备份\\<stamp>`. Sources
  are only read; same-name skills get a source prefix instead of overwriting.
- **Create templates.** Blank, with script (`scripts/main.mjs`) or with reference
  (`reference/notes.md`).
- **Shadow badge.** Cross-root duplicates now say which copy hides them, right on the row.
- **Jump picker.** A skill picker next to the search box filters straight to one skill.

### Changed

- The usage tab, list toolbar and management form share one set of compact controls; the panel now
  counts **24** HTTP routes.

### Tests

- 12 suites / 12 passing, including new `run-trash.mjs` (14), `run-repair.mjs` (13),
  `run-backup.mjs` (11) and `run-template.mjs` (10); client suite 89/89; routes 69/69.

## [0.6.38] - 2026-10-23

### Added

- **Management, for real.** Three writes join the existing switch: create a skill, edit its
  description / when-to-use / body, and import a local folder that contains `SKILL.md`. All three
  only ever touch the two user-level writable roots; project-level roots stay read-only.
- **Delete that cannot lose data.** Deleting copies the whole skill folder into the recycle bin
  (`D:\\回收站\\技能面板删除`) and only then removes the original. The UI asks twice.
- **Backups on every edit.** Each change writes `<file>.bak-<stamp>` first, then replaces the file
  atomically; an unchanged save writes nothing.
- Five new routes: `POST /skill/read`, `/skill/create`, `/skill/update`, `/skill/delete`,
  `/skill/import`.
- New self-test suite `test/run-manage.mjs` (16 assertions), covering the happy paths and the
  refusals: duplicate name, Chinese name, short description, missing `SKILL.md`, non-UTF-8 file,
  path traversal, target outside the writable root.

### Changed

- Route count self-test now expects 19 routes (was 14); client suite 89 assertions.

## [0.6.37] - 2026-10-23

### Added

- **The checkup now answers "why is this skill invisible?"** — two new problem kinds: `root-missing` (a
  configured skill root does not exist, so nothing under it is loaded) and `invalid-entry` (the entry file
  was rejected: no frontmatter, unclosed `---`, bad YAML, missing `name`/`description`, bad name, or
  unreadable). Each row shows a plain-language reason plus the same "what you can do" fix list.
- **Structured `evidence`** on every check row instead of `null`: `shadowedBy` for shadowed skills,
  `status`/`reason` for rejected entries, `path`/`source`/`rank` for missing roots.
- **README screenshots** — `docs/checkup.png` and `docs/list.png`, rendered from the shipped CSS in the
  dark theme.

### Fixed

- Regression coverage for the four-state switch: `off → user-only` now restores the original file name and
  writes `disable-model-invocation` (previously only `off → on` was covered).

### Changed

- Preset scope pinned: this panel **reads** DSH presets and mounts/unmounts skills inside them. Creating,
  renaming or deleting preset folders is explicitly out of scope (a separate preset workbench could do that).

### Verified

- `npm test` 7/7. Diagnostics 55/55 (7 new assertions), four-state 9/9 (1 new), client suite green with the
  two new i18n keys.

## [0.6.36] - 2026-10-23

### Fixed

- **技能下拉框在深色主题下白底白字.** A native `<select>` renders its popup with the OS widget style, so the
  page theme cannot reach it. Replaced with a self-drawn dropdown (same CSS system as the rest of the panel),
  which also brings a search box: type a name or a word from the description to filter the list.

### Added

- **每个技能都带中文说明**: both the mount menu and the already-mounted rows under a preset now show the
  skill's `description` from its `SKILL.md`, so an English folder name is no longer the only thing to go on.
  Same for the 用量 list — `/usage` now returns a `description` per skill (read from the skill definition,
  never from conversations; the on-disk `usage.json` still holds only name / count / lastAt).
- Preset rows carry the description too (`/presets` returns it for both the global pool and each mounted entry).

### Verified

- `npm test` 7/7. The usage privacy check now asserts the on-disk index stays three-field while the response
  may add `description`; route self-test payload shows the field really flows through.
- Dark-theme renders of the real CSS (`out-picker/presets.png`, `out-picker-closed/presets.png`): open menu with
  search + descriptions, closed list with descriptions, all legible, no overflow.

## [0.6.35] - 2026-10-23

### Fixed

- **预设页在深色主题下什么都看不见.** The selected preset row and the "链接 / 预设自带" chips used
  `--dsw-alias-bg-secondary` / `--dsw-alias-line-secondary` — tokens this host does not define — so the
  light fallback (`#f4f5f6`) painted a near-white block and the inherited white text vanished. Every
  style in this view now uses tokens the rest of the panel already relies on
  (`--dsw-alias-interactive-bg-*`, `--dsw-alias-border-l2`, `--dsw-alias-label-*`) with translucent
  grey fallbacks that read correctly on both themes, and the chips are outlined instead of filled.

### Added

- **预设自带的技能现在也能编辑**: a real folder inside a preset gets a 移出 button. It does not delete
  anything — `POST /presets/detach` moves the folder into the global library (`~/.dsh/skills/<name>`)
  and refuses when a same-named skill is already there, so the preset stops carrying it and the skill
  stays available. Links keep using 摘掉, and calling detach on a link is refused with a pointer to 摘掉.

### Verified

- `npm test` 7/7; the route suite now covers detach (moves the real folder, refuses links) and the
  route/ping counts moved to 14/11.
- Dark-theme render of the real CSS + DOM (`out-presets-dark/presets.png`): selected row readable,
  chips readable, 摘掉 / 移出 both legible, no overflow.

## [0.6.34] - 2026-10-23

### Added

- **The 预设 tab now manages the DSH agent presets themselves.** The left column lists every
  folder under `~/.dsh/.agent-presets/`; the right pane shows what that preset carries and lets you
  mount a skill from the global library into it, or unmount one. Mounting creates a Windows directory
  junction (`<preset>/skills/<name>` -> the real skill folder) - the skill itself never moves.
  Unmount removes a link only; a real folder inside a preset is refused, never deleted.
- `lib/agent-presets.js`: list / mount / unmount with a path-traversal guard (the id must be one
  safe folder name under `.agent-presets`), a pool-membership check, and link-only deletion.
- Three host routes: `GET /presets`, `POST /presets/mount`, `POST /presets/unmount`.

### Changed

- The previous "save the current switch state as a preset" view is gone: it kept snapshots in
  localStorage and never touched disk, so nothing it "saved" reached dsh. Preset membership is now
  what dsh actually loads at startup, hence the page says **restart dsh after mounting**.

### Verified

- `npm test` 7/7 suites. The host-route suite walks the whole loop: list -> mount creates a
  junction -> list reports it as a link -> unmount removes only the link -> a `..` preset id and an
  unknown skill name are both refused.
- Read against the real `~/.dsh`: 7 presets found (novel 2 / school 15 / paper 12 / research 7 /
  debate 1 / study 8 / study-guide 2 skills mounted).

## [0.6.33] — 2026-10-22

### Fixed

- The × on a skill card now really removes the skill from its group. The button was wired to the *add*
  handler with a stray third argument, so every click re-assigned the skill to the group it already sat in —
  visually nothing happened. It calls the un-assign handler now.

## [0.6.32] — 2026-10-22

### Fixed

- The × on a skill card did nothing: the new pointer drag started even when the press began on the button,
  so the drop handler swallowed the click. A drag now never starts from a control inside the card, and dropping
  onto the group the skill already sits in is a no-op.

## [0.6.31] — 2026-10-22

### Changed

- Edge auto-scroll is much slower (max 8 px/frame instead of 26), so the page no longer runs away from the pointer.
- Dragging a skill no longer uses the browser's native drag — that is what blocked the wheel. It now follows the
  pointer directly, so **the wheel scrolls the page during a drag** like on any ordinary page. A small ghost shows
  what you are carrying, the group under the pointer gets an outline, dropping on the left column still removes the
  skill from its group, and `Esc` cancels.

## [0.6.30] — 2026-10-22

### Fixed

- Dragging a skill could only reach the groups that were already on screen: while an HTML5 drag
  is in flight the browser refuses to scroll on the wheel. The groups page now scrolls itself
  while you drag — bring the pointer near the top or bottom edge and the page follows, faster the
  closer you get, and it stops as soon as the drop happens or the drag is cancelled. Nothing else
  about dragging changed.

## [0.6.29] — 2026-10-22

### Fixed

- Editing a group near the bottom of the board meant the skill list on the left had already
  scrolled out of view, so there was no way to see what you were dragging. The left pane now
  sticks to the top of the page scroller (`position: sticky; top: 8px; align-self: start`): the
  page still scrolls exactly as before and the right board keeps flowing under it, while the
  pane's inner list keeps its own 70 vh scroll. One rule changed; no other layout property was
  touched.

## [0.6.25] — 2026-10-22

### Fixed

- The member count still floated away from the group name: the name field kept a 200 px basis even
  for a four-character name, so the count started 200 px in. The field now sizes to its own text
  (`field-sizing: content`, with a `size` attribute fallback), so the count sits immediately after
  the name — and the count itself renders as a small pill, so it reads as a badge instead of a
  stray digit.

## [0.6.24] — 2026-10-22

### Changed

- Group boxes are "fit content, capped" again instead of fully auto-height: a group with a few
  skills shrinks to its content, and only a group that overflows the cap (48 vh / max 460 px) gets
  an inner scrollbar. That keeps the board tidy without making every group a scroll trap — a short
  group no longer swallows the wheel, and the page still scrolls normally everywhere else.
- The left "All skills" column scrolls on its own again (max 70 vh), so the board stays compact.

## [0.6.23] — 2026-10-22

### Fixed

- The member count sat far from the group name: the name field was set to grow, so it pushed the
  count to the middle of the header. The name now keeps its natural width (up to 200 px) and the
  count sits right next to it.
- Wheel scrolling over a group scrolled that group's inner list instead of the page. Group boxes
  now size to their content and nothing inside the board scrolls on its own, so the mouse wheel
  always moves the page.

## [0.6.22] — 2026-10-22

### Fixed

- Group board alignment. The "new group" toolbar sat flush right with a large left indent, so
  it lined up with neither the tab row above nor the board below; it now starts at the same
  left edge as everything else, and the board's left gutter is declared in one place instead
  of being split between the pane padding and the grid.
- Group card headers no longer clip. The header row (name input + count + the four-way mode
  segmented control + delete) is wider than a 250 px card, so it overflowed and the group name
  was cut off. The header now wraps, the name input flexes to the space actually available,
  and the grid's minimum column width went from 250 px to 288 px.


### Fixed

- The left "All skills" column now accepts drops. Dragging a card out of a group and
  dropping it on the left column removes it from that group (the left column lists every
  skill, so there is nothing to "add" to). Before this, the column was drag-source only and
  the card snapped back.

## [0.6.20] — 2026-10-22

### Changed

- Group page, right column: the auto-classified cards are no longer dimmed and no longer
  second-class. Every member card now carries the same × as a hand-placed one, and a group's
  name is an input for every group (auto ones too), with a delete button on every group.
- Dragging between groups now **moves** the skill (it leaves the source group) while dragging
  from the left column still **adds** it — a skill may live in several groups, but dragging
  never leaves a duplicate behind. Auto-classified members are moved by recording an explicit
  exclusion for the source group, so the classifier cannot silently put them back.
- Every group (auto ones included) can be renamed and removed; removing an auto group hides it
  rather than losing it.
- New "Reset" button: clears every manual add / remove / rename / hide and restores the default
  six groups. Groups you created yourself are kept.

## [0.6.19] — 2026-10-22

### Fixed

- Group page, left column: the search box stuck out past the pane's right edge. Its own rule
  said `width:auto` but the base `.cockpit-input` rule (further down the sheet, same
  specificity) sets `width:100%`, so the box measured 100% **plus** its 24px of side margins
  and overflowed by exactly that. The gutter is now declared once, as padding on
  `.cockpit-pane`; the title bar, the search box and the skill cards all sit inside it and
  share the same left and right edges, and no child declares a width or a side margin.

## [0.6.18] — 2026-10-22

### Fixed

- Group page, left column: the "全部技能" title bar was flush with the pane edge while
  the search box and the skill cards sat 12px in, so the three left edges stepped inwards.
  The title bar now uses its own `.cockpit-pane-head` with the same 12px gutter and the
  same rounded frame; the search box takes `width:auto` so it also respects that gutter.

## [0.6.17] — 2026-10-22

### Removed

- The per-row "add to group" control is gone entirely (button, chips and their CSS).
  Grouping is done on the group page only: drag a row into a group box (the ungrouped
  bucket included). Rows are shorter and no popup/inline list competes with the card.

## [0.6.16] — 2026-10-22

### Fixed

- The ungrouped row's "add to group" control is now drawn inline instead of as an
  absolutely positioned popup. The group card has a fixed height and `overflow:hidden`,
  so the popup was clipped at the card edge (visible as a black sliver). Chips sit in
  normal flow and can never be cut off.

## [0.6.15] — 2026-10-22

### Changed

- The per-row "Add to group" menu now appears only in the ungrouped bucket. Rows that
  already sit in a group switch groups by dragging, so the control was duplicate clutter
  there; the ungrouped bucket keeps it because that is the only manual entry point.

## [0.6.14] — 2026-10-22

### Fixed

- The group menu now closes when you click anywhere outside it, or press Escape.
  Before, it stayed open until you picked an item or clicked its own trigger.

## [0.6.13] — 2026-10-22

### Fixed

- Group page: the per-row "Add to group" control was a native select. Its popup is drawn by
  the OS, so on the dark theme it rendered white-on-white and the option list was unreadable;
  clicks on it produced no visible result. Replaced with a self-drawn menu that uses the
  Canvas / CanvasText system colours (they flip with color-scheme, so both themes stay
  legible). Picking a group runs the same onAssign path, closes the menu at once, and the
  row tag badge updates as visible feedback. Client-only change: no host restart, Ctrl+F5.

## [0.6.12] — 2026-10-21

### Changed

- npm keywords now carry the DSH discovery set: dsh, dsh-plugin, dsh-bundle, deepseek-harness, cordis, skills, skill-manager, panellist, skill-cockpit. GitHub topics carry the same core set. No code change.

## [0.6.11] — 2026-10-21

### Fixed

- The usage index now carries STORE_VERSION = 2; a store written by an older build is discarded as a whole, which forces one full rescan instead of trusting per-file contributed: {} rows produced by the 0.6.8 detector. Without this, after the detector fix only files that kept growing were recounted (the panel showed 3 skills x2 instead of the real 8/4/4).
- Usage suite: 60 -> 61 assertions.

## [0.6.10] — 2026-10-21

### Documentation

- README first screen rewritten with real numbers (v0.6.10 · 7/7 suites · 351 assertions · npm
  `latest`), npm / license / tests badges, and an install block. The stale "npm carries 0.2.3 /
  6 suites / 287 assertions" status is gone.
- Corrected a false claim carried over from 0.6.8: "104 sessions with 0 skill invocations" was the
  broken detector talking, not reality. The usage bullet now describes the real signal and the
  numbers a re-scan of 113 sessions produced.
- No code changes in this release — documentation only.

## [0.6.9] — 2026-10-21

### Fixed

- **The usage page reported zero skill calls on this host.** The reader only accepted an object
  shaped `source: { kind: 'skill-invocation', name }`, but the runtime records a skill call as a
  content block `{ "type": "tool-call", "name": "skill", "arguments": "{\"name\":\"<skill>\"}" }`
  where `arguments` is a **JSON string**. Both shapes are accepted now; malformed `arguments`,
  missing names and non-`skill` tools are ignored. Re-scanning 113 existing sessions surfaced
  real usage (e.g. `ui-design` ×8, `git-workflow` ×4, `debugging` ×2) that was previously invisible.
- Usage regression suite: 52 → 60 assertions (7/7 suites green).

### Changed

- Group page: the skill list gained a search box; the card layout was restored to the previously
  accepted version after an intermediate experiment was rejected.
- `documented`: CHANGELOG entries for 0.5.x–0.6.8 were never written; this release resumes the
  record. Version numbers in `package.json` remain the source of truth.

## [0.4.0] — 2026-10-20

Visual rework of the panel, driven by a source-level survey of the ecosystem's most-starred
skill panels (`cheshireez/dsh-skill-hub`, `re-ITRT/dsh-skill-mcp-panel`,
`VDERR/dsh-echocat-skill-panel`, `Imzl-zl/dsh-toolbox-ui`). Behaviour, routes and the
single-write action are unchanged: this release only changes how the page looks and reads.

### Changed

- **One grouped card instead of a bordered box per row.** Rows are transparent bands with a
  0.5px hairline separator inside a single rounded card, so 31 skills read as a list rather
  than 31 boxes.
- **Rows carry only what you scan for**: name, one ellipsis line of description, switch.
  The raw entry path (`…/SKILL.md`) now appears only when a row is expanded.
- **Badges are quiet and conditional.** The default row shows one neutral source chip; a tone
  is only used for real exceptions (disabled / broken / shadowed), matching "label only when
  non-default".
- **A 960px centred column** with a 24px/700 title, a single segmented control instead of two
  rows of loose pills, and a fixed type scale (24 / 15 / 15 / 13.5 / 13 / 12.5 / 12 / 11 / 10.5).
- **Styles moved into one scoped `<style>` block** (every selector prefixed `cockpit-`), because
  inline styles cannot express `:hover`, `:focus-visible` or `prefers-reduced-motion`.

### Fixed

- `--dsw-alias-state-warning-primary` does not exist in the host (the real name is
  `--dsw-alias-state-warn-primary`), so the warning colour had been silently falling back to a
  literal on every render. Same class of bug for `--dsw-alias-bg-code` (no such token): button
  fills now use `--dsw-alias-interactive-bg-hover`, and monospace text uses the real
  `--ds-font-family-code`.

### Added

- Keyboard focus ring on rows / controls (`--dsw-focus-ring-width` + `--dsw-focus-ring-color`).
- `prefers-reduced-motion` disables transitions and animation.
- Five source-level guard assertions (280 total) locking the new structure and the two token
  fixes, so a later edit cannot quietly regress to per-row boxes or a dead token.
## [0.4.1] — 2026-10-20

Polish pass on 0.4.0 after the first real-machine look. Visual only; no behaviour change.

### Changed

- **The segmented control reads as one control again.** Under a dark host the 8% hover fill was
  invisible, so "列表/用量/问题" and the filter row fell apart into two clusters of loose pills.
  The capsule now sits on `--dsw-alias-bg-module-platform` with a 0.5px hairline, and the active
  segment is driven by `data-active` instead of an inline colour.
- **"看正文" and "刷新" are ghost buttons.** A filled button on all 31 rows out-shouted the
  content; they are now transparent with tertiary ink and only take a fill/ink on hover.
- **"用量" and "问题" views now use the same language as the list**: one grouped card with
  hairline-separated rows, quiet chips, and the shared `.cockpit-*` classes instead of the old
  inline-styled boxes.
## [0.5.0] — 2026-10-20

Grouping. A flat list of 47 skills is not a list, it is a heap: nothing tells you
where to look. This release gives the list a second dimension.

### Added

- **Six functional groups** — 文档办公 / 代码工程 / 设计视觉 / 写作沟通 / 研究资料 / 元技能.
  A skill carries 1–3 tags, so it can appear under more than one group; each group is
  its own card with a header (name · count · enabled count).
- **Custom groups** — create one with the input above the list, then attach skills to it
  with the per-row 「加入分组…」 dropdown. Custom groups get a delete button in their header.
- **Per-group bulk switch** — 全开 / 全停 on each group header, driving the same single
  `/toggle` route once per member. The only disk write is still the entry-file rename.
- **Tag chips per row** — the groups a skill belongs to are visible on the row itself.

### Notes

- Assignments live in `localStorage` (`dsh-skill-panel.groups.v1`), not on disk: the plugin's
  only write action remains renaming `SKILL.md` ↔ `SKILL.md.disabled`.
- Group membership for skills with no hand-written mapping is guessed from the description
  (keyword fallback); anything unmapped lands in 未分组, which is shown honestly rather than
  silently dropped.
## [0.6.0] — 2026-10-20

The group editor. 0.5.0 organised the list; this release is where you build the
organisation, on a page of its own instead of a dropdown squeezed into a row.

### Added

- **「分组」 page** (second tab, next to 列表) — left pane lists every installed skill
  as a draggable chip, right pane lists the six built-in groups plus your own.
  Drag a chip onto a group and it joins; drag is the whole interaction.
- **Custom groups are editable there** — rename inline, delete with one click,
  members removable with ×. Built-in groups stay fixed (their membership is derived
  from the functional table), so the page shows which chips are yours (solid) and
  which are automatic (dimmed).
- Renames persist immediately: every edit writes the same localStorage record.

### Notes

- Nothing is written to disk. The plugin's only write action is still renaming
  `SKILL.md` ↔ `SKILL.md.disabled`; groups and assignments live in the browser.
- Deleting a group never touches skills — it only drops the assignment record.
## [0.6.1] — 2026-10-20

The board cards. On the 分组 page a skill was a bare chip showing only its name —
`canvas-design` tells you nothing about what it does, so you had to already know.

### Changed

- **Every skill on the 分组 page is now a card**: name on top, two lines of its real
  description underneath (line-clamped, whitespace collapsed). Left pane is a single
  column of full-width cards with its own scroll (62vh); each group renders its members
  as a wrapping grid of the same cards.
- Cards inside a group are still draggable — you can move a skill from one group to
  another by dragging it, not only from the left pane.

### Notes

- Built-in (auto-derived) members render dimmed and without × so it stays obvious that
  their membership comes from the functional table; manually placed ones carry ×.
- Still no disk writes beyond the entry-file rename.
## [0.6.2] — 2026-10-20

Layout and contrast pass on the 分组 page after the first real-machine look: the
right-hand side ran straight down (six groups stacked = a very long scroll), and the
whole page read as flat grey.

### Changed

- **Groups flow into columns instead of stacking**: the right pane is now
  `repeat(auto-fill, minmax(300px, 1fr))`, so on a 960px page six groups become a
  2–3 column board rather than one 6-row column.
- **Contrast raised a step**: cards and group boxes now sit on a visibly lighter
  surface with a `border-l3` hairline (was `border-l2`), and each group header carries
  a 2px brand-coloured inset bar on its left edge so the groups read as separate
  objects instead of one grey field.
- Left column's card list scrolls to 70vh (was 62vh) so more than half a column is
  visible at once.
## [0.6.3] — 2026-10-20

Two things the 0.6.2 pass got wrong, both visible on the first real-machine look.

### Fixed

- **The 分组 page now gives each side its own scrollbar.** 0.6.2 only made the right
  side a grid, so on a viewport where two 300px columns do not fit it collapsed back
  to one column and the page kept growing downward — which looked like nothing had
  changed. The board now has a fixed height (`calc(100vh - 300px)`, min 420px) and both
  columns scroll independently (`overflow:auto` + `scrollbar-gutter:stable`), so the
  page itself never grows. Right-side columns start at 250px so two fit sooner.
- **Colour, not one flat grey.** Each group header now takes a rotating accent from the
  host's own semantic tokens (brand / success / warn / business / error) via
  `data-accent`, rendered as a 3px inset bar — five distinguishable groups instead of
  six identical grey boxes. Group header background moved up one surface step.
## [0.6.4] — 2026-10-20

0.6.3 fixed the columns and the colour, and broke the content: a fixed board height
(`calc(100vh - 300px)`) plus `height:100%` on the grid stretched each group box to a
clipped row, so cards were sliced in half and the right side could not be scrolled.

### Fixed

- **No more fixed board height.** The board is back to natural height
  (`align-items:start`); each column scrolls on its own at `max-height:70vh` with
  `overflow:auto` and `overscroll-behavior:contain`, so nothing is clipped and the
  wheel does not leak to the page when a column ends.
- Group boxes are `align-self:start` with `overflow` no longer hiding their content —
  a box is exactly as tall as its cards.
## [0.6.5] — 2026-10-20

### Fixed

- **整组「全开 / 全停」是一条坏功能，现在修好了。** It returned silently when it found
  no writable target (`if (targets.length === 0) return`), so a click could do nothing
  and say nothing; the buttons also carried `disabled` when the group was already in the
  requested state, so the click never reached the handler. The handler now always answers:
  - all already in that state → notice「这一组已经全部…了，无需操作」
  - every member read-only → error naming the count and why (项目级技能根只读)
  - otherwise → notice「整组停用：成功 N · 跳过 M（只读）· 失败 K」, and a per-run error
    line with the first failing skill.
  Buttons are only disabled while a run is in flight.
- **全开 / 全停 now also exist on the 分组 page** (they were only on the list view).

### Changed

- **Group boxes are all the same height** (`clamp(240px, 40vh, 360px)`) with the card grid
  scrolling inside the box — no more ragged column bottoms, and each group has its own
  scrollbar instead of the whole column scrolling as one.
## [0.6.6] — 2026-10-20

The group-level enable/disable is now expressed as **a switch on the group header**,
not two text buttons — and a fully disabled group greys out, matching how a single
disabled skill looks.

### Changed

- 全开 / 全停 buttons → one tri-state switch (`data-on` / `data-mixed`), on both the
  列表 view's group cards and the 分组 page's group boxes. Mixed state shows the thumb
  halfway; clicking a mixed or partly-on group disables it, clicking an all-off group
  enables it.
- A group whose members are all disabled renders at `opacity:.55` with a muted header
  (`[data-off="1"]`), so an off group is visible at a glance instead of needing to read
  the count line.
## [0.6.8] — 2026-10-20

### Added — real i18n, wired to the host's own locale service

Until now `locale/zh.json` and `locale/en.json` each held a single `meta` key that no code read,
while every string in the UI was hardcoded Chinese. The panel now speaks both languages through
the same contract the top-downloaded skill plugins use:

- `apply(ctx)` resolves the host service as `ctx.get('locale')` — **not** via
  `dsh.client.inject`, deliberately: a missing service then degrades to Chinese instead of
  failing activation.
- Dictionaries register through `localeService.register(LOCALE_NS, MESSAGES)` inside
  `ctx.effect(...)` (so they unregister with the plugin), and the translator comes from
  `localeService.bind(LOCALE_NS)`.
- `t(key, vars)` resolves 宿主 current language → Chinese → the key itself, and interpolates
  `{name}`-style placeholders itself (the host call is `t(key)`, no var injection).
- **Every user-facing string now goes through `t()`.** The dictionary holds **236 keys** with
  identical zh/en key sets and **101 call sites**, covering the four pages, both dialogs, the drag
  board, every empty state, every error line, the root list, the index card and the footer. What is
  left in Chinese is (a) the SKILL.md keyword patterns used to classify skills - they must stay
  Chinese because they match Chinese descriptions - and (b) one developer `console.log`.
- **Language follows the host, and a test proves it.** The new assertion hands `apply()` a fake
  locale service and checks the nav row label comes back as that service's own translation, so the
  panel really defers to the host instead of shipping a private language switch. With no locale
  service the same strings fall back to Chinese, which is what every other assertion exercises.

### Added — five i18n assertions (286 total)

1. the dictionary block parses into `zh` / `en`; 2. both key sets are identical (no missing
translation); 3. **no CJK left in any `en` value** (exact per-entry check, so a half-translated
string fails the suite); 4. every `t('…')` key used in code exists in the dictionary (typos fail);
5. the wiring really is `ctx.get('locale')` + `register` + `bind` (a regression to
`dsh.client.inject` fails).
## [Unreleased]

### Docs

- **Corrected a false claim**: both READMEs said the plugin was *not on npm yet*. It is —`dsh-skill-cockpit@0.2.3` is published under this account (`huanlin-labs`); 0.6.7 is the next release. Install sections now show 
pm install dsh-skill-cockpit and note the published version.
- **Both READMEs brought up to 0.6.7.** They still described 0.3.x: no 分组 page, no tri-state
  group switch, stale suite counts (`274 assertions` / `4/4 套件 · 124 项`), and the Chinese one
  still told readers to mount the package as `dsh-skill-panel` even though the package name is
  `dsh-skill-cockpit`.
- Added a **四个页面 / The four pages** section (列表 · 分组 · 用量 · 问题) and a **Screenshots**
  section that names the four images still to be taken — no placeholder images, no screenshots of
  an older UI.
- `docs/screenshots/README.md` records what each shot must show and the capture rules.
## [0.6.7] — 2026-10-20

Found the actual bug behind "全开 / 全停 点了没反应". It was not the disabled button
(0.6.5) and not the silent return: **the target filter was inverted**.

```js
// before — for 停用 this selected members whose enabled is FALSE, i.e. none
const want = members.filter((s) => s.enabled === !disable)
// after  — 停用 targets the currently-enabled ones, 启用 targets the currently-off ones
const want = members.filter((s) => Boolean(s.enabled) === Boolean(disable))
```

Every click therefore produced `want = []` and answered "这一组已经全部停用了，无需
操作" — which is exactly the notice the panel showed while all five switches were on.

### Fixed

- Group bulk toggle now selects the right members and actually calls `/toggle` once per
  member: 停用 → the enabled ones, 启用 → the disabled ones.

### Added

- Regression assertion (client suite, 281 assertions total) pinning the filter to
  `Boolean(s.enabled) === Boolean(disable)` and rejecting the old inverted form.
## [0.6.8] — 2026-10-20

### Added — real i18n, wired to the host's own locale service

Until now `locale/zh.json` and `locale/en.json` each held a single `meta` key that no code read,
while every string in the UI was hardcoded Chinese. The panel now speaks both languages through
the same contract the top-downloaded skill plugins use:

- `apply(ctx)` resolves the host service as `ctx.get('locale')` — **not** via
  `dsh.client.inject`, deliberately: a missing service then degrades to Chinese instead of
  failing activation.
- Dictionaries register through `localeService.register(LOCALE_NS, MESSAGES)` inside
  `ctx.effect(...)` (so they unregister with the plugin), and the translator comes from
  `localeService.bind(LOCALE_NS)`.
- `t(key, vars)` resolves 宿主 current language → Chinese → the key itself, and interpolates
  `{name}`-style placeholders itself (the host call is `t(key)`, no var injection).
- Converted so far (`t()` call sites; everything falls back to Chinese when the host service is absent):
  nav row + page title, the four tab labels, refresh, copy, loading / not-loaded states, the whole list
  header (project-root lines, search placeholder, group create/delete), row chips and row actions
  (disable / restore / read body / collapse), the provider no-file note, both long "the switch only
  renames the entry file" notes, the roots and index section titles, the usage view (scan line, scope
  line, empty warning, per-row count and last-call time), the problems view (provider note, summary,
  "no problems found"), read-failure and bad-frontmatter copy, and the footer line.
- Still Chinese-only (next slices): the module-scope label maps (reason / source / category names),
  the status filter chips, and the drag-board body copy plus the group-toggle notices. Remaining UI strings are
  being moved over slice by slice; the dictionary is the single place to edit copy from now on.

### Added — five i18n assertions (286 total)

1. the dictionary block parses into `zh` / `en`; 2. both key sets are identical (no missing
translation); 3. **no CJK left in any `en` value** (exact per-entry check, so a half-translated
string fails the suite); 4. every `t('…')` key used in code exists in the dictionary (typos fail);
5. the wiring really is `ctx.get('locale')` + `register` + `bind` (a regression to
`dsh.client.inject` fails).
## [Unreleased]

Public repository opened to reserve the name **`dsh-skill-cockpit`**. The plugin is functional but
the first public release is still being prepared: bilingual docs, screenshots, and a release
checklist are outstanding.

### Known gaps at this point

- No screenshots yet.
- The npm release is still `0.2.3`; `0.3.x` is delivered from source plus the local link.

## [0.3.2] — 2026-10-20

### Fixed

- **`cwd` is optional again, on both routes.** 0.3.1 refused every call that arrived without a
  session cwd — which broke the panel's own switch and its "read body" button on the standalone
  page (that page honestly reports `项目根: 无`, so it never has a cwd). Requiring one added no
  protection: the real boundary is the write-root whitelist, and project-level roots are read-only
  either way.
  - `/body` without `cwd` builds the report without project-level roots and still serves **only**
    entries that report listed; asking for a project-level entry gets a 403 that says why.
  - `/toggle` without `cwd` works inside the two write roots. A `cwd` that does not resolve is
    ignored rather than trusted, so it cannot be used to slip past the write-root gate.

### Changed

- The client sends `cwd` only when a session supplies one, and no longer replaces the body with a
  "no session" placeholder.

### Tests

- 6/6 suites · **275 assertions** (was 274): the two "missing cwd ⇒ 403" cases became the positive
  cases that matter (`/body` reads a user-level entry, `/toggle` renames and restores both work
  without a cwd), plus one new case proving a bogus cwd cannot bypass the write-root gate.

## [0.3.1] — 2026-10-20

A security pass over the two routes that could be abused, done before the first real release.
Both holes were found by review, not by an incident; both now carry a negative test.

### Security

- **`GET /body` is whitelist-only.** It used to read any path the caller named (verified against a
  live host: `?path=C:\Windows\win.ini` returned the file). It now answers **only** for entry files
  that the `/skills` report for the *same* `cwd` listed, compared on real paths; everything else is
  **403 with no content**. The route can no longer be used as a file reader.
- **`POST /toggle` requires a resolvable session and a target inside the two write roots.** The
  request now carries `cwd`; a missing or unresolvable cwd is refused instead of silently falling
  back to the global layer, and the target must resolve inside `~/.dsh/skills` or
  `~/.agents/skills`. Project-level roots stay read-only even when the report lists the file.
- Refusals answer with their own HTTP status (403) instead of the generic 400, so a deliberate
  security refusal is distinguishable from a malformed request.

### Changed

- The client sends `cwd` with `/body` and `/toggle`, and shows a plain note instead of a request
  when there is no session cwd to vouch for the path.

### Tests

- 6/6 suites · **274 assertions** (was 262). Route suite 42 → 54: the new cases cover an
  arbitrary-file `/body`, a `/body` without `cwd`, a `/body` of the plugin's own data file,
  `toggle` without `cwd`, `toggle` with a non-existent `cwd`, `toggle` outside both write roots,
  and the positive path (rename → restore) inside a write root.

## [0.3.0] — 2026-10-20

The version that makes the panel answer **"why isn't this skill working?"** instead of only listing
skills. Two new endpoints, both verified against this machine.

### Added

- **`GET /__dsh-skill-panel/usage`** — how often each skill was actually invoked, read from the
  session logs. Counts are persisted to `<dshHome>/dsh-skill-cockpit/usage.json`; only skill names,
  counts and timestamps are stored, never message text.
  Measured on this machine: **104 sessions scanned, 0 skill invocations** — every installed skill is
  dormant, which is what the panel's empty state now says out loud.
- **`GET /__dsh-skill-panel/checks`** — "loads, but earns nothing" diagnostics in four kinds:
  `shadowed` (a duplicate name loses to a higher-priority root), `short-description` (too short for a
  model to pick), `dir-name-mismatch` (bundle folder ≠ frontmatter `name`), `empty-body` (heuristic,
  measured in file bytes). Measured on this machine: 31 skills, **0 hits in all four kinds** — the
  checks are wired and correct, the local corpus is just clean.
- `lib/usage.js` — session-log reader. The `.zstd` files are a **concatenation of independent zstd
  frames**, not one stream: `zstdDecompressSync(wholeFile)` decodes only the first frame (a 207-byte
  session header), so the reader walks frame by frame. Measured: 8.3 MB → 1183 frames / 2795 events
  in 227 ms.
- `lib/checks.js` — pure functions over the existing `/skills` report; no filesystem access.
- Two client views: usage (with the dormant-skills empty state) and problems.

### Fixed

- **The panel never followed the host theme.** Nine `--dsw-color-*` custom properties were used but
  do not exist in the host; the real names are `--dsw-alias-*`. Every one of them silently fell back
  to a hardcoded colour. They now resolve against the host tokens.

### Tests

- 6 suites / **262 assertions** (was 4 / 124): data layer 23 · toggle 42 · routes 42 (was 22) ·
  client 55 (was 37) · **usage 52** · **checks 48**.

### Note — why some skills cannot be disabled here

The host's skill provider contract is additive: `ctx.skills.registerProvider(() => provider)` lets a
provider contribute its own entries, but offers **no hook to wrap or exclude another provider's
output**. So for skills that live in the filesystem the only lever is renaming the entry file
(`SKILL.md` ↔ `SKILL.md.disabled`), which is what the panel does — and for skills supplied by another
provider (bundled, third-party) the panel cannot disable them at all. The UI says so instead of
showing a switch that does nothing.

## [0.2.3] — 2026-10-14

### Fixed

- **The rename to `dsh-skill-cockpit` had missed the plugin's own identity, so the entry failed to
  activate.** `lib/client.js` registered its bundle as `dsh-skill-panel` and `lib/index.js` exported
  `name = 'dsh-skill-panel'`, while the package — and therefore the loader entry — is
  `dsh-skill-cockpit`. A client bundle must register under its package name: the host normalizes
  both `<package>/client` and the bare package name onto the same graph row. The registration id and
  the exported name now match the package, and the two test assertions that pinned the old name were
  updated.
- The host half reported a stale internal version string (`0.1.0` while the package was `0.2.2`);
  it now reports the package version.

### Note

- A leftover `node_modules` link under the old name lets the same bundle execute twice and aborts web
  boot (`duplicate factory registration`). Renaming a `link:` dependency therefore means rebuilding
  the link **and removing the old one**.

## [0.2.2] — 2026-10-08

Last pre-publication version, developed privately.

### Added

- Locale files (`locale/zh.json`, `locale/en.json`) and their export path.

### Changed

- Dropped the `title` block from `package.json` in favor of a bilingual `description`.

## Earlier private history

| Version | Note |
|---|---|
| 0.2.1 | `SKILL.md.disabled` toggling hardened |
| 0.2.0 | six skill-root kinds enumerated; "why invisible" reasons reported |
| 0.1.0 | first working version: `sidebar.panellist` seat + full page |

### Renamed

The package was previously named `dsh-skill-panel` in private use. The public name is
`dsh-skill-cockpit`; the npm name `dsh-skill-panel` is owned by another author, which is why the
project is published under a new name.

## 1.0.0 — 2026-10-24

- **为什么是 1.0**：面板能力（六类技能根 / 四态开关 / 回收站 / 后备库 / 预设 / 用量 / 体检）与模型接口（`skill_panel` 20 个动作）都已闭环，按 semver 承诺稳定：**以后新增动作 = 1.x（minor），删改动作名或参数 = 2.0**。V3 只是下一轮升级，不是重新起头。

- **二期：把面板剩下的能力交给 dsh**。工具 `skill_panel` 的动作从 11 个扩到 20 个：
  - 后备库：`vault_list` / `vault_put`（= 本机删除 + 名单记一行，需 `confirm: true`）/ `vault_install`（来源是 git 就下载，是本机目录就复制）。
  - DSH 预设：`preset_list` / `preset_mount`（只建 junction，技能本体不动）/ `preset_unmount`（只删链接，真实目录一律拒绝）。
  - `mode_set`：批量切 `on` / `user-only` / `model-only` / `off`，支持 `scope: exclusive` 白名单语义；不带 `confirm: true` 只返回预演（列出每个技能 from → to）。
  - `usage`：会话日志里的调用统计（默认复用已有索引，`refresh: true` 重扫）。
  - `checkup`：体检清单（描述过短 / 目录名不符 / 正文疑似为空 / 同名遮蔽）。
- 参数仍然只有一个 `action` + 同构字段；`create` / `update` 的简介参数固定叫 `summary`（`description` 在 JSON Schema 里是注解关键字，0.12.0 已因此炸过一次）。
- 测试：把写死的「11 个动作」换成「动作表与 ACTIONS 逐条对齐」+「二期动作齐全」两条断言；12/12 套件通过。
