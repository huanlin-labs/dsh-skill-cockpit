# dsh-skill-cockpit

> **Status: early / work in progress.** This repository is being published ahead of its first
> release to reserve the name. The plugin already works end-to-end on the author's machine
> (6/6 self-test suites · 244 assertions) but the public docs, screenshots, and packaging are
> still being finished. Expect the surface below to change.

A **skill cockpit for [DSH](https://github.com/deepseek-ai)** (DeepSeek Harness): one page in the
app-level navigation that shows every skill the machine actually exposes, says **why** a skill is
missing, and lets you toggle a single skill without editing anything but its entry-file name.

[中文说明](README.zh.md)

## What it does

- **One page in the application-level nav.** It takes the official `sidebar.panellist` seat with
  `order: 5` — between the shipped **Plugins** row (0) and the shipped **Schedule** row (10) — plus
  the whole page in the layout's `main` keyed slot. Both seats are registered through the
  framework's `slots` service, the same extension point the shipped pages use.
- **All six skill-root kinds, not just one.** DSH resolves skills from `project-dsh`,
  `project-agents`, `custom`, `user-dsh`, `user-agents`, and `bundled`. Scanning only
  `~/.dsh/skills` under-reports what a session can actually see.
- **It answers "why is this skill not there?"** A malformed frontmatter block makes the runtime
  drop a skill silently. The cockpit reports the concrete reason (`dropped:no-frontmatter`,
  `dropped:unclosed`, `dropped:bad-yaml`, `dropped:missing-fields`, `dropped:bad-name`), plus a
  missing root, a shadowed entry, or an explicit error — instead of showing nothing.
- **It also answers "is anything using this skill?"** The session logs record every skill
  invocation. The cockpit reads them and counts — which is how it can say, out loud, that on this
  machine **104 sessions went by with 0 skill invocations**: everything installed is dormant.
  Counts live in `<dshHome>/dsh-skill-cockpit/usage.json` (skill names, counts, timestamps only —
  never message text).
- **"Loads, but earns nothing" checks.** Four kinds of technically-valid skill that a model will
  still never pick: `shadowed` (a duplicate name loses to a higher-priority root),
  `short-description` (too short to choose between), `dir-name-mismatch` (bundle folder contradicts
  the frontmatter name), `empty-body` (a heuristic, measured in file bytes and labelled as such).
- **Toggling = renaming the entry file only.** Enable/disable flips `SKILL.md` ⇄
  `SKILL.md.disabled`. There is no sidecar state file, so there is exactly one source of truth:
  the filename. **Project-level skill roots are always read-only.**
- **Honest about what it cannot do.** DSH's skill provider contract is additive:
  `ctx.skills.registerProvider(() => provider)` contributes entries, and there is **no hook to wrap
  or exclude another provider's output**. So skills that live in the filesystem are disabled by
  renaming (above), while skills supplied by another provider — bundled or third-party — cannot be
  disabled by this panel at all. Those rows say so instead of showing a switch that silently does
  nothing.
- **No `@deepseek-ai/dsh*` peer dependency at all.** The host half declares `inject = []` and the
  client half declares only `slots`, so the plugin is not subject to DSH's compatibility-exemption
  gate and does not touch the credentials surface.

## HTTP routes (host half, local origin only)

| Method | Path | What |
|---|---|---|
| GET | `/__dsh-skill-panel/ping` | identity, version, route list, writable roots |
| GET | `/__dsh-skill-panel/skills?cwd=…` | the full scan report (`cwd` fixes the project-level roots) |
| GET | `/__dsh-skill-panel/body?path=…` | one entry file's text (read-only, size-capped) |
| GET | `/__dsh-skill-panel/undeclared?q=…` | search the "not installed" index (read-only) |
| GET | `/__dsh-skill-panel/usage` | `{ ok, skills:[{name,count,lastAt}], scanned, skipped, sessions, updatedAt }` |
| GET | `/__dsh-skill-panel/checks?cwd=…` | `{ ok, checks:[{kind,skill,detail}], summary, thresholds, note }` |
| POST | `/__dsh-skill-panel/toggle` | `{ filePath, disable, plan? }` → entry-file rename |

`/usage` writes exactly one file, `<dshHome>/dsh-skill-cockpit/usage.json`, and only ever
stores skill names, invocation counts and timestamps. The scan is incremental: a session log whose
`(size, mtime)` is unchanged is skipped, so the second call on this machine took 21 ms against a
104-session history. Requests carrying a foreign `Origin` are refused with 403.

## Why some skills cannot be disabled

A skill can reach a session down two different roads, and only one of them ends at a file:

- **File-backed** (`user-dsh`, `user-agents`, `custom`, project roots, a bundled directory): the
  entry is a real `SKILL.md` or `x.md`, so the cockpit can park it by renaming the entry file.
- **Provider-backed**: DSH's contract is `ctx.skills.registerProvider(() => provider)` — additive by
  design. A provider contributes its own `list()`; there is **no hook to wrap, filter or exclude
  another provider's output**. Nothing this panel does can make such a skill disappear.

That asymmetry is not a missing feature, it is the host API's shape, so the panel states it
plainly: a provider-supplied row renders `本面板无法禁用（属 … provider）` where the switch would
otherwise sit. A switch that silently did nothing would be worse than no switch.

## Install (from source, for now)

Not on npm yet. Until the first release, clone this repository and mount the working tree into a
profile with a local link:

```bash
git clone https://github.com/zhaorui-wu/dsh-skill-cockpit.git
```

```jsonc
// ~/.dsh/profiles/<profile>/package.json
{
  "dependencies": { "dsh-skill-cockpit": "link:/path/to/dsh-skill-cockpit" },
  "dsh": { "profile": { "bundles": ["…", "dsh-skill-cockpit"] } }
}
```

Then restart DSH. The entry appears in the left navigation as **Skills**.

## Development

```bash
node test/run-all.mjs      # 6 suites: data layer · toggle loop · host routes · client · usage · checks
```

Pure ESM JavaScript, no build step — `lib/*.js` runs as-is.

## Layout

| Path | What |
|---|---|
| `lib/index.js` | host half: local HTTP routes (`/__dsh-skill-panel/*`) |
| `lib/client.js` | client half: the whole UI (classic script, `React.createElement`) |
| `lib/roots.js` · `lib/scan.js` · `lib/frontmatter.js` | six-root enumeration, scan, YAML frontmatter |
| `lib/toggle.js` | the only entry-file writer: 8 guards, rename only |
| `lib/usage.js` | session-log reader → invocation counts (multi-frame zstd, incremental) |
| `lib/checks.js` | pure functions: the four "loads but earns nothing" diagnostics |
| `lib/undeclared.js` | "referenced but not installed" index |
| `test/` | self-tests (no framework) |

## License

[MIT](LICENSE)
