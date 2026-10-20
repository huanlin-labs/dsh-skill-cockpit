# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project intends to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Public repository opened to reserve the name **`dsh-skill-cockpit`**. The plugin is functional but
the first public release is still being prepared: bilingual docs, screenshots, and a release
checklist are outstanding.

### Known gaps at this point

- `README.md` (English) is a stub; the full bilingual documentation is not written yet.
- No screenshots yet.

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
