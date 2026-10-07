# dsh-skill-panel

DSH（DeepSeek Harness）**技能面板**：在 DSH 原生右侧栏里加一整页「技能」，
列出本机**全部**技能、**按技能开关**，并接「未安装技能索引」做第二跳。

- 挂载点：第三方 `dsh-better-sidebar` 对外服务 **`ctx.betterSidebar.registerTab`**（v0.19.0 起注册的 tab 即 DSH 原生右侧栏页面）
- 因此本包**不声明任何 `@deepseek-ai/dsh*` peer** ⇒ 不受 DSH 兼容性豁免闸门影响（见工作区 `AGENTS.md` §四 铁律 1/3）
- 纯 ESM JavaScript，无构建链：`lib/*.js` 直接可跑，自测用 `node` 即可复跑

## 它解决什么

`~/.dsh/skills` 只是**六类技能根**中的一类。只扫它 → 面板少报技能（本机实测 31 vs 会话可见 39）。
更要紧的是：**frontmatter 写坏 = 运行期静默丢弃**（`dsh-skill-filesystem` 解析失败即 `continue`），
用户看到的是"这个技能不存在"，而不是"这个技能写坏了"。

本面板：

| 能力 | 说明 |
|---|---|
| 六类根全枚举 | `project-dsh(100)` / `project-agents(200)` / `custom(300)` / `user-dsh(400)` / `user-agents(500)` / `bundled(600)`，各带 `source` + `rank` |
| 坏 frontmatter 显式报错 | `dropped:no-frontmatter` / `dropped:unclosed` / `dropped:bad-yaml` / `dropped:missing-fields` / `dropped:bad-name`，每条带原因；**"丢了"就显示"丢了"** |
| 根不存在也算一种状态 | 显示"不存在（正常）"；`bundled` 未挂载时显示 `$DSH_BUNDLED_SKILL_DIR` 未设置，而不是假装有 |
| 每技能开关 | 唯一写盘动作 = **改入口文件名**：`SKILL.md ↔ SKILL.md.disabled`（扁平型 `x.md ↔ x.md.disabled`） |
| 会话作用域 | 面板顶部显示"当前会话 cwd / 项目根"；项目级根**只读**（写工作区 = 绕过"工作区=权限域"边界） |
| 第二跳 | 命中「未安装技能索引」时给信息卡 + 复制按钮，**不下载、不安装** |

## 状态即文件名（无第二份状态）

开关状态**每次扫描都从文件名重新读出**，插件里没有 prefs、没有数据库、没有内存副本。
所以面板不可能出现"显示已关、模型照样能加载"的假开关。
（对照：better-sidebar 自带的 `pluginSettings` 管的是"这个 tab 显不显示"，**不是**技能开关。）

## 装配

```jsonc
// ~/.dsh/profiles/<profile>/package.json
"dependencies": { "dsh-skill-panel": "link:D:/插件/dsh-skill-panel" }
```

```yaml
# ~/.dsh/profiles/<profile>/cordis.patch.yml
- insert:
    - id: skill-panel
      name: 'dsh-skill-panel'
      # 可选配置（全部有默认值）：
      # config:
      #   dshHome: 'C:\\Users\\<你>\\.dsh'          # 默认 $DSH_HOME 或 ~/.dsh
      #   agentsHome: 'C:\\Users\\<你>\\.agents'     # 默认 $DSH_AGENTS_HOME 或 ~/.agents
      #   customSkillDirs: []                       # 额外的技能根
      #   bundledSkillDir: ''                       # 默认 $DSH_BUNDLED_SKILL_DIR
      #   includeDefaultRoots: true
      #   writableSources: ['user-dsh']             # 默认 ['user-dsh','user-agents']
      #   undeclaredIndexPath: 'D:\\管家\\技能索引与最小路由\\技能改造\\未安装技能索引-正文.md'
```

改装配 = **要重启 dsh**（进程红线：重启只由户主执行）。技能开关**不需要**重启。

## HTTP 路由（宿主半，本机同源）

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/__dsh-skill-panel/ping` | 插件身份 + 路由清单 + 可写根 |
| GET | `/__dsh-skill-panel/skills?cwd=…` | 全量扫描报告（`cwd` 决定项目级根） |
| GET | `/__dsh-skill-panel/body?path=…` | 读一个入口文件正文（只读，带体积上限） |
| GET | `/__dsh-skill-panel/undeclared?q=…` | 搜未安装技能索引（只读） |
| POST | `/__dsh-skill-panel/toggle` | `{ filePath, disable, plan? }` → 改名（唯一写动作） |

`plan: true` 只算不动 → 面板用它做"确认改名"预告，自测也用它验 dry-run。

写路由的护栏（任一条不满足即拒绝并给中文原因）：
目标必须存在、必须是普通文件（**永不改目录名**）、必须直接位于某个**可写根**内（真实路径比对，防符号链接逃逸）、
必须正好是入口文件（`<目录>/SKILL.md` 或 `<根>/x.md`）、目标名不得已存在（防覆盖）；
另有同源栅栏（带外部 `Origin` 的请求一律 403）。

## 自测

```bash
node test/run-all.mjs [报告目录]
```

四个套件（全部不需要 GUI / 不需要 dsh）：

| 套件 | 覆盖 |
|---|---|
| `run-data-layer.mjs` | 六类根 / `dropped:*` 全可达（合成 fixture）/ `root-missing` / **独立目录遍历比对（不多报、不漏报）** / 字节数与磁盘一致 |
| `run-toggle.mjs` | 在**真实** `~/.dsh/skills` 上对 1 个新建探针做 改名→停用→改回 闭环：sha256 一致、根项数不变、面板仍显示"已停用"、清理后零残留；另含目录/非入口/根外/项目级四类拒绝路径 |
| `run-routes.mjs` | 假 ctx 跑真 `apply()`：5 条路由注册、200/400/403/405、ping |
| `run-client.mjs` | 假 `__ModuleLoader__` + React 桩：bundle 求值、tab 描述符、健康/坏 frontmatter/第二跳/确认条/错误态五种渲染 |

## 边界（有意不做）

- 项目级根**不写**（安全边界：工作区 = 权限域）
- 不安装、不下载、不删除任何技能；停用只改名，文件内容一字节不动
- 不做"最近被加载"（要动宿主埋点，成本大于收益）
- 不用 better-sidebar 的 `pluginSettings` 当技能开关（那是假开关）

## 未实查项（如实标注）

- `bundledSkillDir` 的实际取值：本机 `$DSH_BUNDLED_SKILL_DIR` 未设置、profile patch 里也没有该配置项
  ⇒ 本插件按"未挂载"如实显示。会话可见 39 条 vs `~/.dsh/skills` 31 条的差额来源**仍未定位**
  （`app.asar` 内未见 `reviewer-response` 之类的技能文件；`E:\DSH\resources` 下也无）。面板不会替它猜。
- `@deepseek-ai/dsh-client-*` 原生 Slot 树（设计方案的 H4）未实查：需装 `dsh-tool-cordis`（= 改装配）。

## 许可

MIT。
