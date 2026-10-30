/**
 * 文档一致性自测：把「README / docs 里说的」和「代码里真有的」对齐。
 *
 * 盯三件最容易漂的事：
 *   1. README 的 tests 徽章数字 ≠ run-all 里真实套件数（刚漂过一次：写着 17，实际 18）
 *   2. doctor 新增了检查项，但 troubleshooting 的对照表没写（用户查不到这个 id 是啥）
 *   3. README 里的 docs/ 链接指向不存在的文件
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

let pass = 0
let total = 0
const check = (label, ok, detail) => {
  total += 1
  if (ok) pass += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ← ' + String(detail)}`)
}

const root = join(import.meta.dirname, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

// 1 · 套件数与徽章
const runAll = read('test/run-all.mjs')
const suiteCount = [...runAll.matchAll(/^\s*\['[^']+',\s*join\(import\.meta\.dirname/gm)].length
const badge = /tests-(\d+)%2F\d+%20suites/.exec(read('README.md'))
check('run-all 能数出套件', suiteCount > 0, suiteCount)
check(
  'README 的 tests 徽章 = 真实套件数',
  Boolean(badge) && Number(badge[1]) === suiteCount,
  `徽章 ${badge ? badge[1] : '(没找到)'} / 实际 ${suiteCount}`,
)

const platforms = read('docs/platforms.md')
const platformCount = /(\d+) 个套件/.exec(platforms)
check(
  'platforms 的套件数 = 真实套件数',
  Boolean(platformCount) && Number(platformCount[1]) === suiteCount,
  `platforms ${platformCount ? platformCount[1] : '(没找到)'} / 实际 ${suiteCount}`,
)

// 2 · doctor 检查项都有文档
const doctor = read('bin/cockpit-doctor.mjs')
const ids = [...new Set([...doctor.matchAll(/add\(\s*'([a-z][a-z0-9-]*)'/g)].map((m) => m[1]))].sort()
const table = read('docs/troubleshooting.md')
const documented = new Set([...table.matchAll(/^\|\s*`([a-z][a-z0-9-]*)`\s*\|/gm)].map((m) => m[1]))
const missing = ids.filter((id) => !documented.has(id))
check('doctor 检查项非空', ids.length > 0, ids.length)
check('每个 doctor 检查项都在 troubleshooting 表里', missing.length === 0, missing.join(', '))

// 3 · 公开文档不泄露本机绝对路径
const leakFiles = ['README.md', 'README.zh.md']
for (const f of ['docs/troubleshooting.md', 'docs/platforms.md', 'docs/self-check.md', 'docs/status-ledger.md']) leakFiles.push(f)
const leaks = []
for (const file of leakFiles) {
  const text = read(file)
  for (const m of text.matchAll(/[A-Z]:\\[^\s`'")\]]+/g)) {
    if (/^D:\\|C:\\Users\\zhaorui/i.test(m[0])) leaks.push(`${file} → ${m[0]}`)
  }
}
check('公开文档不含本机绝对路径', leaks.length === 0, leaks.join(' | '))

// 4 · lib 里没有写死的本机路径字面量
const libLeaks = []
for (const file of readdirSync(join(root, 'lib')).filter((f) => f.endsWith('.js'))) {
  const text = read(join('lib', file))
  for (const m of text.matchAll(/'[A-Z]:\\[^'\n]*/g)) {
    if (/^'D:\\|^'C:\\Users\\zhaorui/i.test(m[0])) libLeaks.push(`${file} → ${m[0]}`)
  }
}
check(
  'README 的后备库默认路径与代码一致',
  !read('README.md').includes('skill-vault') && read('README.md').includes('skill-panel/后备库.md'),
  'skill-vault 是旧路径',
);

check(
  'README 的测试示例套件数与真实一致',
  (() => {
    const m = /#\s*(\d+)\s+suites/.exec(read('README.md'));
    return Boolean(m) && Number(m[1]) === suiteCount;
  })(),
  'Development 段写着旧套件数',
);

check(
  'README.zh 的路由条数与 run-routes 一致',
  (() => {
    const m = /registered\.length === (\d+)/.exec(read('test/run-routes.mjs'));
    const n = /\*\*(\d+) 条路由\*\*/.exec(read('README.zh.md'));
    return Boolean(m) && Boolean(n) && m[1] === n[1];
  })(),
  'README.zh 的路由条数过期',
);

check(
  'README 里的套件通过数都等于真实套件数',
  (() => {
    const claims = [...read('README.md').matchAll(/(\d+)\/(\d+) 套件/g)];
    return claims.length > 0 && claims.every((m) => Number(m[1]) === suiteCount && Number(m[2]) === suiteCount);
  })(),
  'README 仍有旧的 x/y 套件数字',
);

check(
  '两版 README 都声明源码与 npm 的差异',
  read('README.md').includes('Source vs npm') && read('README.zh.md').includes('源码 vs npm'),
  '版本边界声明被删掉了',
);

check(
  'README 覆盖 normalizeConfig 的每个配置键',
  (() => {
    const src = read('lib/index.js');
    const start = src.indexOf('const raw = { ...local, ...base };');
    const end = src.indexOf('/** 全局技能库', start);
    if (start < 0 || end < 0) return false;
    const body = src.slice(start, end);
    const keys = [...body.matchAll(/^\s{4}([a-zA-Z][\w]*):/gm)].map((m) => m[1]);
    const readme = read('README.md');
    return keys.length >= 10 && keys.every((k) => readme.includes('`' + k + '`'));
  })(),
  '有配置键只存在于代码、README 没写',
);

check(
  'README 配置键名与代码一致（没有写错键名）',
  read('README.md').includes('reserveListPath') && !read('README.md').includes('reserveDir') && read('lib/index.js').includes('reserveListPath:'),
  'reserveDir → reserveListPath',
);
check('lib 里没有写死的本机路径', libLeaks.length === 0, libLeaks.join(' | '))

// 5 · README 的 docs/ 链接都存在
const badLinks = []
for (const file of ['README.md', 'README.zh.md']) {
  for (const m of read(file).matchAll(/\]\((docs\/[^)\s]+)\)/g)) {
    if (!existsSync(join(root, m[1]))) badLinks.push(`${file} → ${m[1]}`)
  }
}
check('README 里的 docs/ 链接都指得到文件', badLinks.length === 0, badLinks.join(' | '))
// 6 · 发布包 files 覆盖文档与 CHANGELOG，且排除测试产物
const pkg = JSON.parse(read('package.json'))
const required = ['lib', 'bin', 'docs', 'README.md', 'README.zh.md', 'CHANGELOG.md', '!test/out']
check('npm files 覆盖文档与 CHANGELOG 且排除 test/out', required.every((entry) => pkg.files.includes(entry)), pkg.files.join(', '))


check('两版 README 都写明诚实边界（未验证）', read('README.md').includes('未验证') && read('README.zh.md').includes('未验证'), '诚实边界 / 未验证段落被删掉了')

console.log(`\n=== 文档一致性自测：${pass}/${total} 通过（套件 ${suiteCount}）===`)
process.exit(pass === total ? 0 : 1)
