/**
 * 更新暂存区（parked）：更新技能时旧版本先改名挪到这里，删不掉就留着。
 * 面板「回收站」会把这些残壳列出来，只允许彻底删除（不能还原）。
 *
 * 0.11.3 起「检查上游 / 一键更新」整块删除（技能来源无法溯源，本机技能是本地资产），
 * 这个文件只保留清理残壳所需的部分。
 */
import { chmodSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function parkedRootOf(home) {
  return join(home, 'skill-panel-parked');
}

export function listParked(home) {
  const root = parkedRootOf(home);
  if (!existsSync(root)) return [];
  const out = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const p = join(root, entry.name);
    let bytes = 0;
    let files = 0;
    try {
      const walk = (dir) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const q = join(dir, e.name);
          if (e.isDirectory()) walk(q);
          else {
            files += 1;
            bytes += statSync(q).size;
          }
        }
      };
      walk(p);
    } catch {
      // 统计失败不影响列出
    }
    let deletedAt = '';
    try {
      deletedAt = statSync(p).mtime.toISOString().replace('T', ' ').slice(0, 16);
    } catch {
      deletedAt = '?';
    }
    out.push({ id: 'parked:' + entry.name, name: entry.name, deletedAt, files, bytes, restorable: false });
  }
  return out;
}

/** 递归清掉只读位（Windows 上 .git 里的对象文件常是只读）。 */
function clearReadonly(root) {
  let entries = [];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const p = join(root, entry.name);
    try {
      if (entry.isDirectory()) {
        clearReadonly(p);
        chmodSync(p, 0o777);
      } else {
        chmodSync(p, 0o666);
      }
    } catch {
      // 单个失败不影响整体
    }
  }
}

/** 尽力删除；删不掉返回 false，由调用方决定怎么报。 */
function removeDirBestEffort(dir) {
  try {
    clearReadonly(dir);
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    return true;
  } catch {
    return false;
  }
}

export function purgeParked(home, name) {
  const root = parkedRootOf(home);
  const target = join(root, name);
  if (!target.startsWith(root)) throw new Error('拒绝：路径越界');
  if (!existsSync(target)) return { ok: true, purged: name };
  if (!removeDirBestEffort(target)) throw new Error('删不掉（可能被占用），稍后再试');
  return { ok: true, purged: name };
}
