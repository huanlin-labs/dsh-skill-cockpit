/**
 * cockpit-doctor 自测：版本、--home 隔离、--fix、退出码、JSON 形状。
 * 全部在系统临时目录里跑，不碰真实家目录。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import zlib from 'node:zlib'

const root = join(import.meta.dirname, '..')
const doctor = join(root, 'bin', 'cockpit-doctor.mjs')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const run = (args) => spawnSync(process.execPath, [doctor, ...args], { encoding: 'utf8' })

let pass = 0
let total = 0
const check = (label, ok, detail) => {
  total += 1
  if (ok) pass += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ← ' + JSON.stringify(detail)}`)
}

const base = join(tmpdir(), 'skill-panel-doctor-test')
// 8 · --version（必须在参数解析之前处理）
const version = run(['--version'])
check('--version 输出名称与版本', version.status === 0 && version.stdout.trim() === `${pkg.name} ${pkg.version}`, { code: version.status, out: version.stdout.trim() })
rmSync(base, { recursive: true, force: true })
mkdirSync(base, { recursive: true })

// 1 · --version 在参数解析之前
const v = run(['--version'])
check('--version 输出包名 + 版本', v.status === 0 && v.stdout.trim() === `${pkg.name} ${pkg.version}`, v.stdout + v.stderr)

// 2 · 空 home：warn → 退出码 1
const home1 = join(base, 'home-empty')
mkdirSync(home1, { recursive: true })
const empty = run(['--json', '--home', home1])
let payload = {}
try {
  payload = JSON.parse(empty.stdout)
} catch {
  payload = {}
}
check('空 home 缺 user-dsh 技能根 → 退出码 1', empty.status === 1 && payload.ok === false, { code: empty.status, out: empty.stdout.slice(0, 200) })
check('JSON 里带 checks 列表', Array.isArray(payload.checks) && payload.checks.some((c) => c.id === 'user-skills'), payload.checks)

// 3 · --fix 补上技能根 → 退出码 0
const fixed = run(['--json', '--home', home1, '--fix'])
let fixedPayload = {}
try {
  fixedPayload = JSON.parse(fixed.stdout)
} catch {
  fixedPayload = {}
}
check('--fix 后退出码 0', fixed.status === 0 && fixedPayload.ok === true, { code: fixed.status, out: fixed.stdout.slice(0, 300) })
check('--fix 真建了 user-dsh 技能根', existsSync(join(home1, '.dsh', 'skills')), join(home1, '.dsh', 'skills'))
check('状态目录在 --home 之下（不碰真实家目录）', fixedPayload.stateDir === join(home1, '.dsh', 'skill-cockpit'), fixedPayload.stateDir)
check(
  'zstd 解压能力有独立检查项（缺 API 时如实说用量会偏低）',
  fixedPayload.checks.some(
    (c) =>
      c.id === 'zstd' &&
      (typeof zlib.zstdDecompressSync === 'function' ? c.status === 'ok' : c.status === 'skip'),
  ),
  fixedPayload.checks,
)
check(
  '空 home 的会话日志项是 skip（不影响退出码）',
  fixedPayload.checks.some((c) => c.id === 'session-logs' && c.status === 'skip'),
  fixedPayload.checks,
)

// 4 · 装配里挂了包 → assembly ok
const home2 = join(base, 'home-assembled')
mkdirSync(join(home2, '.dsh', 'profiles', 'desktop'), { recursive: true })
writeFileSync(join(home2, '.dsh', 'profiles', 'desktop', 'package.json'), JSON.stringify({ dependencies: { [pkg.name]: '^1' } }))
mkdirSync(join(home2, '.dsh', 'skills', 'demo'), { recursive: true })
writeFileSync(join(home2, '.dsh', 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: 这是一个用于自测的示例技能描述，长度足够\n---\n\n正文\n')
const assembled = run(['--json', '--home', home2])
let assembledPayload = {}
try {
  assembledPayload = JSON.parse(assembled.stdout)
} catch {
  assembledPayload = {}
}
check('装配命中 → assembly ok 且退出码 0', assembled.status === 0 && assembledPayload.checks.some((c) => c.id === 'assembly' && c.status === 'ok'), assembledPayload.checks)
check('技能计数 ≥1', assembledPayload.checks.some((c) => c.id === 'skill-count' && c.status === 'ok'), assembledPayload.checks)
check('默认位置 → roots-safe ok', assembledPayload.checks.some((c) => c.id === 'roots-safe' && c.status === 'ok'), assembledPayload.checks)

// 4.2 · 自定义 backupRoot 落进技能根 → roots-safe bad，退出码 1
const homeUnsafe = join(base, 'home-unsafe-roots')
mkdirSync(join(homeUnsafe, '.dsh', 'skills', 'demo'), { recursive: true })
mkdirSync(join(homeUnsafe, '.dsh', 'skill-cockpit'), { recursive: true })
writeFileSync(join(homeUnsafe, '.dsh', 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: 这是一个用于自测的示例技能描述，长度足够\n---\n\n正文\n')
writeFileSync(join(homeUnsafe, '.dsh', 'skill-cockpit', 'local.json'), JSON.stringify({ backupRoot: join(homeUnsafe, '.dsh', 'skills', 'backup') }))
const unsafe = run(['--json', '--home', homeUnsafe])
let unsafePayload = {}
try {
  unsafePayload = JSON.parse(unsafe.stdout)
} catch {
  unsafePayload = {}
}
check('backupRoot 在技能根内 → roots-safe bad 且退出码 1', unsafe.status === 1 && unsafePayload.checks?.some((c) => c.id === 'roots-safe' && c.status === 'bad'), { code: unsafe.status, checks: unsafePayload.checks })
// 4.3 · 自定义技能根也纳入检查
const homeCustom = join(base, 'home-custom-roots')
mkdirSync(join(homeCustom, '.dsh', 'skill-cockpit'), { recursive: true })
const customRoot = join(homeCustom, 'custom-skills')
mkdirSync(customRoot, { recursive: true })
writeFileSync(join(homeCustom, '.dsh', 'skill-cockpit', 'local.json'), JSON.stringify({ customSkillDirs: [customRoot], trashRoot: join(customRoot, 'trash') }))
const customRun = run(['--json', '--home', homeCustom])
let customPayload = {}
try {
  customPayload = JSON.parse(customRun.stdout)
} catch {
  customPayload = {}
}
check('customSkillDirs 内的 trashRoot → roots-safe bad', customRun.status === 1 && customPayload.checks?.some((c) => c.id === 'roots-safe' && c.status === 'bad'), { code: customRun.status, checks: customPayload.checks })
// 4.5 · reserveListPath 也在必须位于技能根外的清单里
const homeReserve = join(base, 'home-reserve-list')
mkdirSync(join(homeReserve, '.dsh', 'skills'), { recursive: true })
mkdirSync(join(homeReserve, '.dsh', 'skill-cockpit'), { recursive: true })
writeFileSync(join(homeReserve, '.dsh', 'skill-cockpit', 'local.json'), JSON.stringify({ reserveListPath: join(homeReserve, '.dsh', 'skills', 'vault.md') }))
const reserveRun = run(['--json', '--home', homeReserve])
let reservePayload = {}
try {
  reservePayload = JSON.parse(reserveRun.stdout)
} catch {
  reservePayload = {}
}
check('reserveListPath 在技能根内 → roots-safe bad', reserveRun.status === 1 && reservePayload.checks?.some((c) => c.id === 'roots-safe' && c.status === 'bad'), { code: reserveRun.status, checks: reservePayload.checks })
// 4.6 · bundledSkillDir 也算技能根
const homeBundled = join(base, 'home-bundled-dir')
mkdirSync(join(homeBundled, '.dsh', 'skill-cockpit'), { recursive: true })
const bundledDir = join(homeBundled, 'bundled-skills')
mkdirSync(bundledDir, { recursive: true })
writeFileSync(join(homeBundled, '.dsh', 'skill-cockpit', 'local.json'), JSON.stringify({ bundledSkillDir: bundledDir, backupRoot: join(bundledDir, 'backup') }))
const bundledRun = run(['--json', '--home', homeBundled])
let bundledPayload = {}
try {
  bundledPayload = JSON.parse(bundledRun.stdout)
} catch {
  bundledPayload = {}
}
check('bundledSkillDir 内的 backupRoot → roots-safe bad', bundledRun.status === 1 && bundledPayload.checks?.some((c) => c.id === 'roots-safe' && c.status === 'bad'), { code: bundledRun.status, checks: bundledPayload.checks })
// 4.7 · local.json 的 agentsHome 覆盖也按实际技能根检查
const homeAgents = join(base, 'home-agents-override')
mkdirSync(join(homeAgents, '.dsh', 'skill-cockpit'), { recursive: true })
const customAgents = join(homeAgents, 'my-agents')
mkdirSync(join(customAgents, 'skills'), { recursive: true })
writeFileSync(join(homeAgents, '.dsh', 'skill-cockpit', 'local.json'), JSON.stringify({ agentsHome: customAgents, backupRoot: join(customAgents, 'skills', 'backup') }))
const agentsRun = run(['--json', '--home', homeAgents])
let agentsPayload = {}
try {
  agentsPayload = JSON.parse(agentsRun.stdout)
} catch {
  agentsPayload = {}
}
check('agentsHome 覆盖后的技能根内 backupRoot → roots-safe bad', agentsRun.status === 1 && agentsPayload.checks?.some((c) => c.id === 'roots-safe' && c.status === 'bad'), { code: agentsRun.status, checks: agentsPayload.checks })
// 4.8 · local.json 的 dshHome 覆盖也按实际技能根检查
const homeDsh = join(base, 'home-dsh-override')
mkdirSync(join(homeDsh, '.dsh', 'skill-cockpit'), { recursive: true })
const customDsh = join(homeDsh, 'my-dsh')
mkdirSync(join(customDsh, 'skills'), { recursive: true })
writeFileSync(join(homeDsh, '.dsh', 'skill-cockpit', 'local.json'), JSON.stringify({ dshHome: customDsh, reserveListPath: join(customDsh, 'skills', 'vault.md') }))
const dshRun = run(['--json', '--home', homeDsh])
let dshPayload = {}
try {
  dshPayload = JSON.parse(dshRun.stdout)
} catch {
  dshPayload = {}
}
check('dshHome 覆盖后的技能根内 reserveListPath → roots-safe bad', dshRun.status === 1 && dshPayload.checks?.some((c) => c.id === 'roots-safe' && c.status === 'bad'), { code: dshRun.status, checks: dshPayload.checks })




// 4.4 · local.json 坏掉 → 不装成 ok，明确报 bad 并让 roots-safe skip
const homeBroken = join(base, 'home-broken-config')
mkdirSync(join(homeBroken, '.dsh', 'skill-cockpit'), { recursive: true })
writeFileSync(join(homeBroken, '.dsh', 'skill-cockpit', 'local.json'), '{ not valid json')
const brokenRun = run(['--json', '--home', homeBroken])
let brokenPayload = {}
try {
  brokenPayload = JSON.parse(brokenRun.stdout)
} catch {
  brokenPayload = {}
}
check('local.json 解析失败 → local-config bad 且 roots-safe skip', brokenRun.status === 1 && brokenPayload.checks?.some((c) => c.id === 'local-config' && c.status === 'bad') && brokenPayload.checks?.some((c) => c.id === 'roots-safe' && c.status === 'skip'), { code: brokenRun.status, checks: brokenPayload.checks })




// 4.5 · --dry-run：报告将要做的事，但不落盘
const homeDry = join(base, 'home-dry')
mkdirSync(homeDry, { recursive: true })
const dry = run(['--json', '--home', homeDry, '--fix', '--dry-run'])
let dryPayload = {}
try {
  dryPayload = JSON.parse(dry.stdout)
} catch {
  dryPayload = {}
}
check(
  '--dry-run 报 wanted 且不创建目录',
  dry.status === 1 && dryPayload.dryRun === true && !existsSync(join(homeDry, '.dsh', 'skills')),
  { code: dry.status, checks: dryPayload.checks },
)

// 5 · home 不存在且不给 --fix → 环境问题，退出码 2
const missing = run(['--json', '--home', join(base, 'nope')])
check('home 不存在 → 退出码 2', missing.status === 2, { code: missing.status, out: missing.stdout + missing.stderr })

// 6 · 人读模式可读
const human = run(['--home', home2])
check('人读模式有标题行', human.status === 0 && human.stdout.includes(`${pkg.name} ${pkg.version}`), human.stdout.slice(0, 160))

// 7 · --report 写出只读报告（不改其它任何东西）
const reportFile = join(base, 'report', 'doctor.json')
const withReport = run(['--home', home1, '--report', reportFile])
const reportOk = existsSync(reportFile)
let reportPayload = {}
if (reportOk) {
  try {
    reportPayload = JSON.parse(readFileSync(reportFile, 'utf8'))
  } catch {
    reportPayload = {}
  }
}
check(
  '--report 写出 JSON 报告',
  withReport.status === 0 && reportOk && reportPayload.name === pkg.name && Array.isArray(reportPayload.checks),
  { code: withReport.status, file: reportFile, out: withReport.stdout.slice(0, 160) },
)

rmSync(base, { recursive: true, force: true })
console.log(`\n${pass}/${total} 通过`)
process.exit(pass === total ? 0 : 1)
