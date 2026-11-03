# Security policy

## Supported versions

The latest npm release and the `main` branch receive security fixes.

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting:

1. Open <https://github.com/huanlin-labs/dsh-skill-cockpit/security/advisories/new>.
2. Describe the impact, the affected version, and a minimal reproduction.
3. If the issue involves a local path or a skill file, redact personal
   information from logs and screenshots.

You should receive an acknowledgement within a few days. Please allow time
for a fix before public disclosure.

## Scope reminders

This plugin is a local UI and HTTP surface inside DSH. It is **not** a
sandbox. It intentionally:

- reads the skill roots DSH exposes;
- writes only inside `~/.dsh/skills` and `~/.agents/skills`;
- keeps its own state in `~/.dsh/skill-cockpit/`;
- refuses writes outside those roots;
- rejects cross-origin requests to its local routes.

Reports about bypassing those boundaries are in scope. Reports that assume
the plugin can stop other local processes, antivirus software or a user with
filesystem access are out of scope.
