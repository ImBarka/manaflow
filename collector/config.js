import { appendFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function configDir() {
  return process.env.MANAFLOW_HOME || join(homedir(), '.config', 'manaflow')
}

function read(name, fallback) {
  try {
    return JSON.parse(readFileSync(join(configDir(), name), 'utf8'))
  } catch {
    return fallback
  }
}

function write(name, value) {
  mkdirSync(configDir(), { recursive: true })
  writeFileSync(join(configDir(), name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}

// config.json: serverUrl, token, deviceId, deviceName
export const loadConfig = () => read('config.json', null)
export const saveConfig = (config) => write('config.json', config)

// state.json: sent (key -> fingerprint of what the server already has), lastPush
export const loadState = () => read('state.json', { sent: {}, lastPush: null })
export const saveState = (state) => write('state.json', state)

const MAX_LOG_BYTES = 256 * 1024

// push.log: one line per scheduled run, since a scheduled run has no terminal.
export function appendLog(text) {
  const path = join(configDir(), 'push.log')
  mkdirSync(configDir(), { recursive: true })
  try {
    if (statSync(path).size > MAX_LOG_BYTES) writeFileSync(path, readFileSync(path, 'utf8').slice(-MAX_LOG_BYTES / 2))
  } catch {
    // no log yet
  }
  appendFileSync(path, `${new Date().toISOString()} ${text.trim().replaceAll('\n', ' | ')}\n`)
}

export function removeAll() {
  rmSync(configDir(), { recursive: true, force: true })
}
