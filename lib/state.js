import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * 插件自己的状态目录（gloss.json / local.json 等）。
 *
 * 默认 ~/.dsh/skill-cockpit；设置 SKILL_COCKPIT_HOME 可整体重定向——
 * verify:install 与 CI 靠它把状态写进临时目录，绝不碰用户真实配置。
 */
export function stateDir() {
  const override = (process.env.SKILL_COCKPIT_HOME || '').trim()
  return override || join(homedir(), '.dsh', 'skill-cockpit')
}

export function stateFile(name) {
  return join(stateDir(), name)
}
