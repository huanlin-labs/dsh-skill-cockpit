# 交付前自检（逐条打勾，打不了勾就说明没做完）

> 对应「平台扩展提示词」第 7 步。**只勾有证据的**；没有证据的写"未做"。
> 最后更新：2026-10-27。

- [x] **平台矩阵每一格都填了实话，没有"应该可以"**
      证据：`docs/platforms.md`。四个入口：Windows 真机（已验证）、macOS（未验证：CI job 已配但没跑过）、Linux（同）、别的 harness（不支持）。

- [x] **每个平台都有 adapter + 单测 + 接线 + doctor + 文档**
      本插件只有 DSH 一个宿主，按等价物落地：唯一入口 `lib/index.js`、19 个测试套件、装配交给 DSH（插件不改 profile）、`dsh-skill-cockpit-doctor`、`docs/platforms.md` + 双语 README。
      证据：`npm test` → `19/19 个套件通过`（本轮实测）。

- [x] **接线器连跑三遍不产生重复项；`--dry-run` 不落盘；`--home` 能重定向**
      这里没有"接线器"，对应物是 `doctor --fix`：幂等（目录已存在即 `ok`，不重复创建）；`--dry-run` 只报 `wanted` 不写盘（`test/run-doctor.mjs` 有断言）；`--home` 把 home / 状态目录全重定向。
      证据：`node test/run-doctor.mjs` → `23/23 通过`（含 `--dry-run` 只报 `wanted`、`--report` 写出 JSON）。

- [x] **`verify:install` 全绿：空 home → `--fix` → 装机副本 `--version` → 复检**
      证据：`npm run verify:install` → `13 通过 / 0 失败`，其中包含"空 home 先报需要修"、"`--fix` 后复检全绿"、"再 `--fix` 仍全绿（幂等）"、"装机副本 doctor --version 输出包名+版本"。

- [ ] **三平台 CI 全绿，tag 那趟还核对了 registry 版本**
      状态：**未做/未验**。工作流已写好（语法 3 平台 × 20/22/24；套件 ubuntu+windows；verify:install 3 平台；tag job 核对 registry `latest`），但仓库**还没 push 过**，GitHub 上一次都没跑。**没有绿之前不勾。**

- [x] **入口判定、`--version` 在参数解析之前**
      `bin/cockpit-doctor.mjs` 顶部先处理 `--version` / `-v`，再解析其它参数；`test/run-doctor.mjs` 有对应断言。本插件没有"符号链接入口判定"的场景（没有 argv[1] 自比较逻辑），故该条不适用。

- [x] **所有状态路径都能用环境变量覆盖**
      `SKILL_COCKPIT_HOME` 覆盖 `gloss.json` / `local.json`（`lib/state.js`）；`DSH_HOME` / `DSH_AGENTS_HOME` 覆盖技能根（`lib/roots.js`）；`doctor --home` 把两者一起重定向。

- [x] **README 显眼处写了"硬拦 vs 建议"和"未验证清单"**
      对应物是「诚实边界 / Honest boundaries」段：只在 Windows 真机验过、macOS 的语法/install job 已配但没跑过、翻译依赖免费接口、一键修会改文件但有 `.bak`、不是沙箱、调用次数只是下界。

- [ ] **每个平台一个版本一个 tag，CHANGELOG 一条一条**
      状态：**未做**。当前只有 DSH 一个平台；`CHANGELOG` 有「未发布」段但**没有发版、没有 tag**——按户主「我让你交你再交」执行。

- [x] **真机跑过至少一次"应当被拒"的调用，并把拒绝原文贴进 docs**
      证据：`test/run-repair.mjs` 的"缺描述且正文空：拒绝而不是编"、"没有 frontmatter：拒绝"、"根外文件：拒绝"，本轮实测 15/15；拒绝原文形如 `拒绝：description 缺失且正文里找不到可用的一句；请手动填写`。
      说明：这是单测层面，不是 GUI 层面；GUI 上的等价证据是上一轮户主截图的「一键修」链路，本轮改的是"修不了要说出来"。

---

## 一句话结论

**9 条里 7 条有证据，2 条（CI 首跑、发版 tag）明确未做。**
没做到"真机跑过一次被拒 + 出包能装能跑"之前，任何地方都不写"支持某某平台"。
