import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { stateDir, stateFile } from './state.js'

export const GLOSS_FILE = stateFile('gloss.json')
const DIR = stateDir()

export function readGloss() {
  try {
    const parsed = JSON.parse(readFileSync(GLOSS_FILE, 'utf8'))
    const raw = parsed && typeof parsed.items === 'object' && parsed.items ? parsed.items : {}
    const out = {}
    for (const [name, zh] of Object.entries(raw)) {
      if (typeof name === 'string' && name && typeof zh === 'string' && zh.trim()) out[name] = zh
    }
    return out
  } catch {
    return {}
  }
}

export function writeGloss(items) {
  mkdirSync(DIR, { recursive: true })
  writeFileSync(GLOSS_FILE, JSON.stringify({ version: 1, items }, null, 2) + '\n', 'utf8')
  return items
}

export function setGloss(name, zh) {
  if (typeof name !== 'string' || !name) throw new Error('name 必填')
  const items = readGloss()
  const value = typeof zh === 'string' ? zh.replace(/\s+/g, ' ').trim() : ''
  if (!value) delete items[name]
  else items[name] = value.slice(0, 240)
  return writeGloss(items)
}
