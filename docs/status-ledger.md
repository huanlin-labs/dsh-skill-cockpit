# 状态台账（2026-11-03 校准）

> 用途：把"待办 / 边界 / 未实查"按**代码与实测**逐条判一次，防止拿过期清单排期。
> 判定只有三种：**已实现**（给证据）/ **真缺**（给下一步）/ **有意不做**（给理由）。

## 一、历史 backlog

| 项 | 判定 | 证据 |
|---|---|---|
| 按技能「不自动加载」（perSkillOff） | **已实现**（1.1.0） | 行内「不用」按钮写 `perSkillOff`（`lib/client.js:1450` 附近）→ `normalizeSettings` 保留（`lib/autoload.js:202`）→ `planInjection` 传入（`lib/autoload-runtime.js:120`）→ `selectSkills` 用 `off.has(name)` 过滤（`lib/autoload.js:244`）；断言在 `test/run-autoload.mjs:132`、`test/run-autoload-wire.mjs:59`。 |
| 预设强绑（list / mount / detach / unmount） | **已实现**（路由 4 条） | `lib/agent-presets.js` 四个导出；`lib/index.js:632-635` 四条路由；端到端在 `test/run-routes.mjs`（列 → 挂 → 标 link → 卸）；安全边界单测 14 项在 `test/run-presets.mjs`。 |

## 二、README「边界（有意不做）」校准

| 原文 | 判定 | 说明 |
|---|---|---|
| 项目级根不写 | **有意不做**（仍然成立） | 写入白名单只有 `~/.dsh/skills` 与 `~/.agents/skills`；其余根只读。 |
| "不删除任何技能" | **已过期，已改写** | 面板有「删除」：先整份复制进插件回收站、二次确认；`purge` 才永久删。 |
| 不做"最近被加载" | **有意不做**（仍然成立） | 要宿主埋点，成本大于收益。 |
| "不保留任何面板侧开关状态" | **已过期，已改写** | 技能开关状态只在文件名（`SKILL.md` ↔ `.disabled`）；面板自己存偏好（自动加载档位 / 必用 / 不用 / 译文），落在 `~/.dsh/skill-cockpit/`。 |

## 三、"未实查项"现状

| 项 | 判定 | 说明 |
|---|---|---|
| `bundledSkillDir` 取值 / 会话可见 39 vs 磁盘 31 的差额 | **已定位，不是 bug** | 实测 `DSH_BUNDLED_SKILL_DIR` 未设置、profile 里也没有 `bundledSkillDir` ⇒ 本机**没有 bundled 根**，面板显示"未挂载"是对的。差额来自宿主 `registerProvider` 直供的非文件技能（面板自己的 `checks.providerNote` 已写明只能看不能开关）；文件根实测 65 个目录 / 65 个 `SKILL.md`，一致。 |
| 原生 Slot 树（H4） | **已实查** | 从运行中的 `app.asar`（0.2.0-rc.2）字节扫描确认两个座位与 `order` 语义。 |
| 面板 `order` 取 5 还是生态惯例 30 | **已裁决：5** | 按户主明确要求；改回只需改 `lib/client.js` 的 `PANEL_ORDER`。 |
| 重启后真实 GUI 渲染 | **已实查（2026-10-31 · 1.5.1）** | 左侧「技能」入口可点开主区整页；`Slots/listSubTree` 中 `sidebar.panellist` 与 `main` 的 `skill-panel` 均 `active: true`；面板渲染 76/76 技能，体检 76 条无问题。 |

## 四、CI 与发布

| 项 | 判定 | 说明 |
|---|---|---|
| GitHub Actions 首跑 | **发现真缺 → 已修** | 历史 `ci` 全 failure：① 5 个测试文件写死 `file:///D:/插件/...` 绝对导入；② `run-routes` / `run-usage` 静态导入 `zstdCompressSync`（Node 20 没有）；③ `run-toggle` 在干净 home 直接 exit 1。三处已改：相对导入、zstd 可选（无 API 时写纯文本 fixture / 明确 SKIP）、缺技能根自动建空目录。 |
| 本机复验 | **通过（含整套跨版本）** | Node 24（系统）：`19/19`；Node 20.20.2：`19/19`；Node 22.11.0：`19/19`；三者 `verify:install` 均 `13/13`。Windows Node 22 上的 `0xC0000409` 复现于硬编码 `D:/临时` 的测试沙箱；改为 `os.tmpdir()` 后本机全绿，CI 官方 `setup-node` 结果见下。 |
| npm `1.5.0` | **已发布可解析** | `npm view dsh-skill-cockpit dist-tags.latest` = 1.5.0；GitHub Release `v1.5.0` 已建。 |
| `npm run release:check` | **10 PASS / 0 FAIL / 0 UNKNOWN** | 2026-10-30 实跑：package 1.5.0、CHANGELOG 顶部 1.5.0、npm latest 1.5.0、本地/远端 tag v1.5.0、GitHub Release、keywords、repository、bundle patch、topics 全 PASS；结论「四处一致，可以发版」。 |
| tag 触发的 `registry-tag` 任务 | **尚未跑过** | 下次打 tag 时验证。 |
| 三平台全量首绿 | **通过** | run `41076632643`（commit `77f5276`）：27 个 job 全绿 —— ubuntu / macOS 15 / windows × Node 20/22/24，语法 + 全量套件 + `verify:install`。macOS 固定用 `macos-15`，避开 `macos-latest` 的镜像退役抖动。 |
| npm `1.5.1` | **已发布可解析** | `npm view dsh-skill-cockpit dist-tags.latest` = `1.5.1`。 |
| `1.5.1` 的 `release:check` | **10 PASS / 0 FAIL / 0 UNKNOWN** | 2026-10-30 实跑：npm latest 1.5.1、本地/远端 tag `v1.5.1`（commit `3d28d38`）、GitHub Release、keywords、repository、bundle patch、topics 全 PASS；结论「四处一致，可以发版」。 |
| `1.5.1` 的 `registry-tag` | **通过** | tag 推送触发的 run `41077709997` 全绿（27 个 matrix job + `registry-tag`）；npm `latest` = `1.5.1`。 |

## 五、边界说明

- Windows 桌面 DSH = 唯一真机验证平台；macOS / Linux 在 CI 跑语法、全量套件与 `verify:install`；Linux 另在本机 WSL（Ubuntu 24.04，Node 24.22.2）跑过 19/19。
- 本文件只记判定，不重复 README 的功能说明。

## 六、2026-10-27 续修校准

| 项 | 判定 | 证据 |
|---|---|---|
| 备份根 / 回收站根可配进技能目录 | **已修** | `assertOutsideSkillRoots` 统一校验；`backupRootOf` / `trashRootOf` 均拒绝技能根内路径；`test/run-routes.mjs` 两条负向断言（备份、删除各一）。 |
| `backupRoot` 显式配置是否生效 | **已覆盖** | 路由自测第二个假 ctx 配自定义 `backupRoot`，断言 `dest` 落在自定义目录。 |
| README 配置键清单 | **已补全并加闸** | 常用 7 键 + 高级 8 键；`run-docs` 从 `normalizeConfig` 提取全部键，缺任一即 FAIL。 |
| 发布包洁净性 | **通过** | 2026-10-27 `npm pack --dry-run --json`：65 个文件、压缩 350543 B、解包 933278 B；含 `docs/status-ledger.md`、两版 README、CHANGELOG；无 `test/out`、无 `local.json`。 |
| 自测文档计数 | **实测一致** | 2026-10-27 复跑：`run-doctor.mjs` **23/23**、`run-repair.mjs` **15/15**，与 `docs/self-check.md` 写的数字相同。 |
| 安全加固后跨版本复验 | **通过** | 2026-10-27：Node 20.20.2、22.11.0 各跑 `test/run-all.mjs`，均 **19/19**（含新增的 82 条路由断言与 17 条文档断言）。 |
| 源码态 vs npm 已发布态 | **已声明并加闸** | 中英 README 顶部均有差异声明；`run-docs` 断言两处声明存在。 |

## 七、2026-10-31 重启后真机复验（1.5.1）

> 环境：Windows 11 · DSH 桌面版 · 本机 dsh 进程已由户主重启；插件版本 `/ping` = `1.5.1`。

| 项 | 判定 | 证据 |
|---|---|---|
| 宿主加载版本 | **通过** | `GET http://127.0.0.1:19387/__dsh-skill-panel/ping` 返回 `{"ok":true,"name":"dsh-skill-cockpit","version":"1.5.1",...}`；路由表含 `/ping` `/skills` `/body` `/undeclared` `/usage` `/checks` `POST /toggle` `/presets/*`。 |
| 左侧入口 | **通过** | 原生侧栏点击「技能」进入主区整页；`Slots/listSubTree(root="sidebar.panellist")` 中 `{registrant:"Gb", id:"skill-panel", order:5, active:true}`。 |
| 主区槽位 | **通过** | `Slots/listSubTree(root="main")` 的 `occupants` 含 `{registrant:"Gb", key:"skill-panel", priority:0, active:true}`。 |
| 面板渲染与体检 | **通过** | 页面标题「技能 共 76 条 · 启用 76 · 停用 0 · 模型实际可见 76」；体检摘要「体检通过：76 条技能，没发现问题」。 |
| 新建技能 | **通过（开→取消）** | 点「+ 新建技能」出现表单（技能名 / 模板 / 简介 / 何时使用 / 正文 Markdown / 取消 / 保存）；点「取消」关闭，未写盘。 |
| 翻译 | **通过** | 点「翻译」后页面显示「✓ 已翻译 11 个」；`~/.dsh/skill-cockpit/gloss.json` 的 `gloss` 检查由 24 条增至 35 条。 |
| 自动加载档位 | **通过（往返恢复）** | 点「严格」后 `skill_autoload status` = `strict`；点「标准」后恢复 `standard`。 |
| 一键修 | **无可修项，未触发** | 体检 76 条全部通过，页面不显示「一键修」；这是“没有缺陷可修”的结果，不是按钮缺失。 |
| doctor | **通过** | `node bin/cockpit-doctor.mjs --json` exit 0，9/9 ok：local-config / roots-safe / state / user-skills / skill-count:76 / assembly / gloss:35 / session-logs:154 / zstd。 |

## 八、2026-11-03/04 1.5.6 发布与真机复核

> 1.5.6 已于 2026-11-04 发布：npm `latest` = 1.5.6、tag `v1.5.6`、GitHub Release 均已建立。逐控件证据表见 `docs/gui-verification.md`。

| 项 | 判定 | 证据 |
|---|---|---|
| 三处版本串 | **已修** | `package.json` / `lib/index.js` / `lib/client.js` 均为 `1.5.6`；`npm test` 19/19；`npm run verify:install` 13/13，装机副本 `/ping` 返回 `dsh-skill-cockpit 1.5.6`。 |
| 当前页面渲染 | **通过** | 页脚 `面板版本 v1.5.6`；标题 `共 76 条 · 启用 76 · 停用 0 · 模型实际可见 76`；体检摘要 `体检通过：76 条技能，没发现问题`。 |
| 七个视图 | **通过（渲染层）** | 列表 / 分组 / 预设 / 用量 / 回收站 / 后备库 / 体检逐页点开并读到各自根内容；`test/render-create.mjs` 断言 7 个视图切换可渲染。 |
| 一键修 | **通过（真机 + 临时夹具）** | 在用户技能根建临时坏技能（缺 `name`、`description: 短`）→ 点「一键修」→ 文件补出 `name: skillpanel-repair-probe-20261103b` 与 `description: "短——一键修临时探针 B"`，并留下 `SKILL.md.bak-2026-11-03T12-26-43-764Z`；页面提示 `✓ 已修复 … description 太短（12 字），补上正文第一段`。夹具验完已整体移到本机回收站的 `skillpanel-repair-probes-20261103` 文件夹，技能数回到 76。 |
| 发布面 | **已完成** | `npm run release:check`：PASS 10 / FAIL 0 / UNKNOWN 0 —— npm latest 1.5.6、本地/远端 tag `v1.5.6`（bed3dc9）、GitHub Release `v1.5.6` 全部一致。 |
| 重启后宿主半 | **已通过** | 2026-11-04 重启后 `GET /__dsh-skill-panel/ping` 返回 **1.5.6**（pid 35096 / 启动 17:28:15）。「备份全部」生成 `2026-11-04T09-30-32-824Z`，磁盘实查 76 个技能 / 2242 个文件 / 79,703,006 字节。 |
