# 出问题了？先跑 `doctor`，再照这张表查

```bash
npx dsh-skill-cockpit-doctor          # 人读
npx dsh-skill-cockpit-doctor --json   # 机器读 / 贴 issue
```

退出码：`0` 就绪 · `1` 有要修的（`--fix` 能补一部分）· `2` 环境问题（home 不存在、报告写不出去）。

## 检查项对照表

| 检查 id | 它在问什么 | `warn` / `bad` 时怎么办 |
|---|---|---|
| `state` | `~/.dsh/skill-cockpit/` 能不能建、能不能写 | 目录被占或没权限。先看该路径是不是个文件；是就改名挪走。跑 `--fix` 只建目录、不删东西。 |
| `user-skills` | `~/.dsh/skills` 这个技能根在不在 | 跑 `--fix` 建空目录即可（空目录不会让面板出错，只是没有「用户技能」那一栏）。 |
| `skill-count` | 数得到几个技能（只看一层，跳过 `node_modules` 与点目录） | 是 `skip` 只表示 0 个，不代表坏。装了技能还是 0，就看技能是不是真在 `~/.dsh/skills/<名字>/SKILL.md`。 |
| `assembly` | 你的 profile 里有没有挂 `dsh-skill-cockpit` | 没挂 → 面板一定不出现。按 README「安装」第 ② 步加进 `package.json` 或 `cordis.patch.yml`，然后重启 DSH。`--fix` **不会**替你改装配。 |
| `local-config` | `local.json` 是否能解析 | 报 `bad` 说明 JSON 坏了；doctor 会同时把 `roots-safe` 标为 `skip`（不假装检查过）。修好 JSON 或临时改名该文件。 |
| `roots-safe` | `trashRoot` / `backupRoot` / `reserveListPath` 是否落在技能根内 | 落在里面会被宿主半拒绝（避免把技能删/备份/后备名单放进自己的扫描面）。把 `local.json` 里对应路径改到技能根外，通常放 `~/.dsh/skill-cockpit/` 下。 |
| `gloss` | 译文缓存条数（`gloss.json`） | 0 条正常（还没点过「翻译」）。文件坏了会退回 0，不影响面板，只影响中文摘要。 |
| `session-logs` | `~/.dsh/sessions` 下数得到几个会话日志 | 这是「用量」页的数据源。0 个 = 用量永远是 0（新装环境正常）。**读不到**会写原因，多半是权限或 home 指错。 |
| `zstd` | 当前 Node 有没有 zstd 解压 API（`.zstd` 会话日志能不能读） | `skip` = 这个 Node 没有 `zstdDecompressSync`（需要 Node 22.15+/24）。不是面板坏了，但用量会偏低甚至为 0；换 Node 或用 DSH 自带运行时即可。 |

## 三个常见现象

**面板完全不出现**
1. `doctor --json` 看 `assembly`：不是 `ok` → 回 README 第 ② 步。
2. 装配对了但还没重启 DSH → 重启（宿主半的路由只在启动时注册）。
3. 还是不行 → 看 DSH 控制台有没有这个插件的报错；零输出通常意味着模块压根没被导入。

**面板在，但「用量」全是 0**
先看 `session-logs`。是 `skip` 且 detail 写「没有会话日志」→ 环境里确实没有；是 `ok` 但数字很大 → 用量统计只认 `tool-call` 里 `name: "skill"` 这一种形状，别的入口调技能不计。

**「一键修」修不了**
它会明说原因（例如「description 缺失且正文里找不到可用的一句」）。这是**故意的**：它不编内容。自己补一句描述再修，或者直接编辑 `SKILL.md`——改前它会先写 `.bak-<时间戳>`。

## 它查不到什么（别误会）

- 查不到"宿主为什么禁用某个插件"——那要看 DSH 自己的插件管理器状态与 `compatibility.json`（属宿主/管家域）。
- 不会替你改 profile 装配、不会动别人的技能文件（除你点「一键修」时、且只改你点的那份）。
- `--home <dir>` 只影响它自己看的路径，不改你的真实环境。
