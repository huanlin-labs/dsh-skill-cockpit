#!/usr/bin/env node
/**
 * cockpit-doctor —— 「面板为什么没出现 / 为什么是空的」自查。
 *
 * 用法：
 *   dsh-skill-cockpit-doctor                 # 人读
 *   dsh-skill-cockpit-doctor --json          # 机器读
 *   dsh-skill-cockpit-doctor --home <dir>    # 全部路径重定向到临时 home（测试/CI 用）
 *   dsh-skill-cockpit-doctor --fix           # 只补能安全补的：状态目录、缺失的 user-dsh 技能根
 *   dsh-skill-cockpit-doctor --version       # 在参数解析之前处理
 *
 * 退出码：0 = 一切就绪 / 1 = 需要修（--fix 能补的） / 2 = 环境问题（读不了 home 等）
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import zlib from 'node:zlib'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'))
const NAME = PKG.name
const VERSION = PKG.version
const PACKAGE_MARK = NAME

const argv = process.argv.slice(2)
// --version 必须在参数解析之前（否则会被当成未知参数）
if (argv.includes('--version') || argv.includes('-v')) {
  console.log(`${NAME} ${VERSION}`)
  process.exit(0)
}

const flag = (name) => argv.includes(name)
const valueOf = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
}

const asJson = flag('--json')
const doFix = flag('--fix')
const dryRun = flag('--dry-run')
const homeArg = valueOf('--home')
const reportPath = valueOf('--report')

const checks = []
const add = (id, label, status, detail) => checks.push({ id, label, status, detail: detail ?? null })

let baseHome
try {
  baseHome = resolve(homeArg ?? homedir())
  if (!existsSync(baseHome)) {
    if (doFix) mkdirSync(baseHome, { recursive: true })
    else throw new Error(`home 不存在：${baseHome}`)
  }
  statSync(baseHome)
} catch (error) {
  const payload = { ok: false, name: NAME, version: VERSION, exitCode: 2, error: error.message, checks }
  if (asJson) console.log(JSON.stringify(payload, null, 2))
  else console.error(`${NAME} ${VERSION}\n[env] 读不了 home：${error.message}`)
  process.exit(2)
}

const dshHome = join(baseHome, '.dsh')
const agentsHome = join(baseHome, '.agents')
const stateDir = process.env.SKILL_COCKPIT_HOME || join(dshHome, 'skill-cockpit')
let userSkills = join(dshHome, 'skills')
// 2.5 · 回收站 / 备份根不能在技能根内（与宿主半的硬拒绝保持一致，提前报出来）
const localConfigPath = join(stateDir, 'local.json')
let localConfig = {}
let localConfigError = null
try {
  localConfig = JSON.parse(readFileSync(localConfigPath, 'utf8'))
} catch (error) {
  if (existsSync(localConfigPath)) localConfigError = error.message
  localConfig = {}
}
if (localConfigError) {
  add('local-config', 'local.json 可解析', 'bad', `${localConfigPath} — ${localConfigError}`)
} else if (existsSync(localConfigPath)) {
  add('local-config', 'local.json 可解析', 'ok', localConfigPath)
} else {
  add('local-config', 'local.json 可解析', 'skip', '没有 local.json（用默认配置）')
}
const configDshHome = typeof localConfig.dshHome === 'string' && localConfig.dshHome.trim() !== ''
  ? localConfig.dshHome
  : dshHome
userSkills = join(configDshHome, 'skills')
const customSkillDirs = Array.isArray(localConfig.customSkillDirs)
  ? localConfig.customSkillDirs.filter((dir) => typeof dir === 'string' && dir.trim() !== '')
  : []
const bundledSkillDirs = typeof localConfig.bundledSkillDir === 'string' && localConfig.bundledSkillDir.trim() !== ''
  ? [localConfig.bundledSkillDir]
  : []
const configAgentsHome = typeof localConfig.agentsHome === 'string' && localConfig.agentsHome.trim() !== ''
  ? localConfig.agentsHome
  : agentsHome
const skillRoots = [userSkills, join(configAgentsHome, 'skills'), ...customSkillDirs, ...bundledSkillDirs].map((root) => resolve(root))
const configuredRoots = ['trashRoot', 'backupRoot', 'reserveListPath'].filter(
  (key) => typeof localConfig[key] === 'string' && localConfig[key].trim() !== '',
)
const unsafeRoots = configuredRoots.filter((key) => {
  const target = resolve(localConfig[key])
  return skillRoots.some((root) => target === root || target.startsWith(root + sep))
})
if (unsafeRoots.length > 0) {
  add('roots-safe', '路径配置不在技能根内', 'bad', unsafeRoots.map((key) => `${key}=${localConfig[key]}`).join('；') + ' — 请改到技能根外；检查根: ' + skillRoots.join(' | '))
} else {
  if (localConfigError) add('roots-safe', '路径配置不在技能根内', 'skip', 'local.json 解析失败，无法判断')
  add('roots-safe', '路径配置不在技能根内', 'ok', (configuredRoots.length > 0 ? configuredRoots.map((key) => `${key}=${localConfig[key]}`).join('；') : '未配置（用默认位置）') + '；检查根: ' + skillRoots.join(' | '))
}


// 1 · 状态目录可写
try {
  if (dryRun) {
    add('state', '状态目录可写', existsSync(stateDir) ? 'ok' : 'wanted', stateDir)
  } else {
    mkdirSync(stateDir, { recursive: true })
    const probe = join(stateDir, `.doctor-probe-${process.pid}`)
    writeFileSync(probe, 'ok')
    rmSync(probe, { force: true })
    add('state', '状态目录可写', 'ok', stateDir)
  }
} catch (error) {
  add('state', '状态目录可写', 'bad', `${stateDir} — ${error.message}`)
}

// 2 · user-dsh 技能根
if (existsSync(userSkills)) {
  add('user-skills', '用户技能根存在', 'ok', userSkills)
} else if (doFix) {
  try {
    if (dryRun) {
      add('user-skills', '用户技能根存在', 'wanted', `将创建 ${userSkills}`)
    } else {
      mkdirSync(userSkills, { recursive: true })
      add('user-skills', '用户技能根存在', 'fixed', `已创建 ${userSkills}`)
    }
  } catch (error) {
    add('user-skills', '用户技能根存在', 'bad', error.message)
  }
} else {
  add('user-skills', '用户技能根存在', 'warn', `${userSkills} 不存在（--fix 会建）`)
}

// 3 · 数技能（只数 SKILL.md，跟随一层目录，不深入 node_modules）
const countSkills = (dir) => {
  let n = 0
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    if (existsSync(join(dir, entry.name, 'SKILL.md'))) n += 1
  }
  return n
}
const userCount = existsSync(userSkills) ? countSkills(userSkills) : 0
add('skill-count', '可读技能数', userCount > 0 ? 'ok' : 'skip', `user-dsh: ${userCount} 个`)

// 4 · 装配里有没有挂这个包
const profilesDir = join(dshHome, 'profiles')
let assembled = null
let profileNames = []
try {
  if (existsSync(profilesDir)) {
    for (const entry of readdirSync(profilesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dir = join(profilesDir, entry.name)
      profileNames.push(entry.name)
      for (const file of ['package.json', 'cordis.patch.yml', 'cordis.yml']) {
        const path = join(dir, file)
        if (!existsSync(path)) continue
        if (readFileSync(path, 'utf8').includes(PACKAGE_MARK)) {
          assembled = path
          break
        }
      }
      if (assembled) break
    }
    if (assembled) add('assembly', '装配里已挂', 'ok', assembled)
    else add('assembly', '装配里已挂', 'warn', `profiles/${profileNames.join(',')} 里都没找到 ${PACKAGE_MARK}`)
  } else {
    add('assembly', '装配里已挂', 'skip', '没有 profiles 目录（不是 DSH 桌面版安装）')
  }
} catch (error) {
  add('assembly', '装配里已挂', 'warn', error.message)
}

// 5 · 译文缓存
let glossCount = 0
try {
  const raw = JSON.parse(readFileSync(join(stateDir, 'gloss.json'), 'utf8'))
  glossCount = raw && typeof raw.items === 'object' && raw.items ? Object.keys(raw.items).length : 0
} catch {
  glossCount = 0
}
add('gloss', '译文缓存', glossCount > 0 ? 'ok' : 'skip', `${glossCount} 条`)

// 6 · 会话日志（用量页的数据源）：数得清就说数，数不清就说读不到
let sessionFiles = 0
let sessionError = ''
const countSessions = (dir, depth) => {
  if (depth > 4) return
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    sessionError = error.message
    return
  }
  for (const entry of entries) {
    if (entry.isDirectory()) countSessions(join(dir, entry.name), depth + 1)
    else if (/^session(\.[a-z0-9]+)?\.jsonl\.zstd$/i.test(entry.name)) sessionFiles += 1
  }
}
countSessions(join(baseHome, '.dsh', 'sessions'), 0)
add(
  'session-logs',
  '会话日志可读（用量页数据源）',
  sessionFiles > 0 ? 'ok' : 'skip',
  sessionFiles > 0
    ? `${sessionFiles} 个会话日志`
    : sessionError
      ? `读不到：${sessionError}`
      : '没有会话日志（用量会是 0，属正常）',
)

// 7 · zstd 解压能力（用量页能不能读 .zstd 会话日志）
const hasZstd = typeof zlib.zstdDecompressSync === 'function'
add(
  'zstd',
  'zstd 解压可用（用量页）',
  hasZstd ? 'ok' : 'skip',
  hasZstd
    ? `Node ${process.version}`
    : `Node ${process.version} 没有 zstdDecompressSync（需要 22.15+/24）：.zstd 会话日志读不了，用量会偏低甚至为 0`,
)

const bad = checks.filter((c) => ['bad', 'warn', 'wanted'].includes(c.status))
const exitCode = bad.length === 0 ? 0 : 1

const payload = {
  ok: exitCode === 0,
  name: NAME,
  version: VERSION,
  home: baseHome,
  stateDir,
  exitCode,
  fixed: doFix,
  dryRun: dryRun,
  checks,
}

let reportNote = null
if (reportPath) {
  try {
    mkdirSync(dirname(resolve(reportPath)), { recursive: true })
    writeFileSync(resolve(reportPath), JSON.stringify(payload, null, 2) + '\n', 'utf8')
    reportNote = '报告已写出：' + resolve(reportPath)
  } catch (error) {
    reportNote = '报告写出失败：' + error.message
    payload.ok = false
    payload.exitCode = 2
  }
}

if (asJson) {
  console.log(JSON.stringify(payload, null, 2))
} else {
  console.log(`${NAME} ${VERSION}  ·  home=${baseHome}`)
  for (const c of checks) {
    const tag = { ok: 'ok  ', fixed: 'fix ', wanted: 'want', warn: 'warn', bad: 'BAD ', skip: 'skip' }[c.status] ?? c.status
    console.log(`[${tag}] ${c.label}${c.detail ? ' — ' + c.detail : ''}`)
  }
  if (reportNote) console.log(reportNote)
  console.log(
    payload.exitCode === 0
      ? (dryRun ? '一切就绪（dry-run 未落盘）。' : '一切就绪。面板没出现的话：重启 DSH，再确认左侧导航「插件」与「自动化任务」之间。')
      : '有需要处理的项：能自动补的跑 --fix；装配那项要装进 profile 并重启 DSH。',
  )
}

process.exit(payload.exitCode)
