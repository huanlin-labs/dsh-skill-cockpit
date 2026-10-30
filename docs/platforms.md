# 平台矩阵（这份表只写实话）

> 生成于 2026-10-27。每一格的「判断依据」都指向能复核的东西（CI job、脚本或本机实测）。
> **没有真机跑过的格，就写"未验证"。**

## 一、这个插件能"接"在哪里

| 平台 / 入口 | 能力档位 | 判断依据 | 验证状态 |
|---|---|---|---|
| DSH 桌面版（Windows） | **完整**：页面 + `skill_panel` 工具 + 全部 HTTP 路由 | 本机 Windows 11 真机装 1.4.1；1.5.0 源码已真机重启加载，左侧导航出现「技能」，翻译/一键修/体检均真机点过；`docs/` 与本仓库 `test/` 记录在案 | 已验证（真机会话） |
| DSH 桌面版（macOS） | **未知**：插件机制同构，但没人跑过真机会话 | CI 里已配 `syntax` / `verify-install` 两个 job 覆盖 macOS，但**还没推送跑过**；本机也没有 macOS | 未验证 |
| DSH 桌面版（Linux） | **未知**：同上；本机 WSL 里连 node 都没有（`npm` 是 Windows 侧互操作），所以连本地套件都没跑过 | CI 里已配 `syntax` / `verify-install` 覆盖 ubuntu，但**还没推送跑过** | 未验证 |
| 其他 harness（Claude Code / Zcode / opencode / pi …） | **不支持，且不打算支持** | 技能根只认 DSH 解析出的六个来源；别的 harness 目录属于它们的隔离区，本插件不读不写 | 未开始 |

## 二、"接上"到底意味着什么（能力档位定义）

- **完整**：页面能渲染、工具能被模型调用、路由能被宿主注册 —— 三件事都有真机证据。
- **未知**：代码层面应该能跑，但没有真机证据。**说"未知"，不说"支持"。**
- **不支持**：按设计不做。

## 三、每个平台该有什么（本插件的五件套对应物）

| 检查项 | 这里的对应物 | 位置 |
|---|---|---|
| 适配器 | 不需要：插件只有 DSH 一个宿主。宿主半 `lib/index.js` 是唯一入口 | `lib/index.js` |
| 单测 | 19 个套件（含队列/路由/客户端/回收站/自动加载/渲染冒烟/诊断 CLI） | `test/run-all.mjs` |
| 接线器 | 装配由 DSH 自己管（bundles / `cordis.patch.yml`）。插件不替用户改 profile | 见 README「安装」 |
| 体检 | `dsh-skill-cockpit-doctor`：`--json` / `--home` / `--fix` / `--version`，退出码 0/1/2 | `bin/cockpit-doctor.mjs` |
| 文档 | 本文件 + README（含「诚实边界」段）+ CHANGELOG | `docs/`、`README.md` |

## 四、自动化证据

- `npm test` —— 19/19 套件（其中 doctor 套件 23 项，含 `--dry-run` 不落盘、`--report` 写出 JSON、`zstd` 能力检查）。
- `npm run verify:install` —— 13 项断言：pack → 空目录安装 → 装机副本启动 → `/ping` → 装机副本 `doctor --version` → 空 home 先报需要修 → `--fix` → 复检全绿 → 再 `--fix` 仍全绿（幂等）→ 状态目录隔离。
- CI（已写入 `.github/workflows/ci.yml`，**尚未推送跑过**）：语法 3 平台 × Node 20/22/24；全量自测 ubuntu + windows × 20/22/24；`verify:install` 3 平台 × 20/22/24；推 tag 时核对 registry `latest`。

## 五、它看不见什么

- 绕过 DSH 直接读取技能目录的进程。
- 技能文件被别的东西改写（本插件只在用户点「一键修」/「新建」/「保存」时写）。
- 调用次数的全量：只统计会话日志里 `tool-call`（`name: "skill"`）这一个形状。
- 译文质量：翻译来自免费公共接口，只保证"没中文的补上中文"，不保证语义精确。
