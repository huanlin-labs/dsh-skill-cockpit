## Summary

<!-- One or two sentences: what changed and why. -->

## Verification

<!-- Paste the commands you actually ran and their results. -->

- [ ] `npm test` — ___/___ suites
- [ ] `npm run verify:install` — ___/13 checks
- [ ] `node test/run-docs.mjs` — 17/17 (or updated count)
- [ ] `node bin/cockpit-doctor.mjs --json` — ___/9 checks

## Honest boundary

- What did you **not** verify? (platform, GUI path, network dependency)
- Does this change require a DSH restart?

## Checklist

- [ ] No `@deepseek-ai/dsh*` peer dependency added
- [ ] New user-visible strings exist in both `zh` and `en`
- [ ] New route has a uniqueness assertion and origin check
- [ ] Version numbers stay in sync (`package.json`, `lib/index.js`, `lib/client.js`)
- [ ] `CHANGELOG.md` updated for user-visible changes
