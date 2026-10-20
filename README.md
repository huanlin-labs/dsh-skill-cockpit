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
node test/run-all.mjs      # 4 suites: data layer · toggle loop · host routes · client
```

Pure ESM JavaScript, no build step — `lib/*.js` runs as-is.

## Layout

| Path | What |
|---|---|
| `lib/index.js` | host half: local HTTP routes (`/__dsh-skill-panel/*`) |
| `lib/client.js` | client half: the whole UI (classic script, `React.createElement`) |
| `lib/roots.js` · `lib/scan.js` · `lib/frontmatter.js` | six-root enumeration, scan, YAML frontmatter |
| `lib/toggle.js` | the only writer: 8 guards, entry-file rename only |
| `lib/undeclared.js` | "referenced but not installed" index |
| `test/` | self-tests (no framework) |

## License

[MIT](LICENSE)
