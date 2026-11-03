# Contributing to dsh-skill-cockpit

Thanks for taking the time to improve the skill cockpit. This project is a
small, dependency-free DSH plugin; the fastest way to keep it healthy is to
make every change reproducible.

## Before you start

- Read `README.md` and `README.zh.md`'s **Honest boundaries** sections.
- Read `docs/status-ledger.md` to see what is actually verified.
- For security issues, **do not open a public issue** — see `SECURITY.md`.

## Development setup

Requirements: Node.js >= 20.11. There is no build step and no runtime
dependency.

```bash
git clone https://github.com/huanlin-labs/dsh-skill-cockpit.git
cd dsh-skill-cockpit
npm test
npm run verify:install
npm run release:check -- --offline
node test/run-docs.mjs
```

`npm test` runs all self-test suites. `verify:install` packs the tarball,
installs it into an empty directory and boots that installed copy.
`release:check --offline` checks local release metadata without network
calls.

## What to change

- Keep the host half in `lib/index.js` and the client half in `lib/client.js`.
- The plugin is ESM (`"type": "module"`); do not add `require()`.
- Do not add `@deepseek-ai/dsh*` peer dependencies.
- A skill toggle must only rename the entry file (`SKILL.md` ↔
  `SKILL.md.disabled`); do not rewrite skill bodies.
- Project-level skill roots are read-only by design.
- New user-visible strings need both `zh` and `en` entries.
- New HTTP routes need a uniqueness assertion and an origin check.
- Add a regression test for every behaviour change. A fix without a test is
  not finished.

## Before opening a pull request

```bash
npm test
npm run verify:install
node test/run-docs.mjs
node bin/cockpit-doctor.mjs --json
```

Update `CHANGELOG.md` when the change is user-visible. If you touched a
version number, update `package.json`, `lib/index.js` and `lib/client.js`
together — the route and client tests assert this.

In the PR description, state:

1. What changed and why.
2. What you actually ran (commands + results).
3. What is **not** verified (platforms, GUI paths, network-dependent paths).
4. Any migration or restart requirement.

## Commit style

Use a short imperative subject, for example:

- `fix: keep panel version in sync with package.json`
- `test: cover groups / presets / trash render paths`
- `docs: record post-restart GUI evidence`

## Code of conduct

Participation is covered by `CODE_OF_CONDUCT.md`.
