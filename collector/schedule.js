import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir, userInfo } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { UserError } from './errors.js'

export const INTERVAL_MINUTES = 30

const TASK_NAME = 'Manaflow Push'
const LABEL = 'com.manaflow.push'
const UNIT = 'manaflow-push'
const CRON_MARKER = '# manaflow'

function pushCommand() {
  return [process.execPath, fileURLToPath(new URL('./cli.js', import.meta.url)), 'push', '--log']
}

function quoted(command) {
  return command.map((arg) => (/[\s"]/.test(arg) ? `"${arg}"` : arg)).join(' ')
}

function exec(file, args, options = {}) {
  return execFileSync(file, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, ...options })
}

function succeeds(file, args) {
  try {
    exec(file, args)
    return true
  } catch {
    return false
  }
}

function xml(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

// Registered from XML rather than schtasks flags: the flag form refuses to
// start on battery, which on a laptop means it would rarely run at all.
// conhost --headless keeps a console window from flashing up every interval.
export function windowsTaskXml(command) {
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <TimeTrigger>
      <Repetition>
        <Interval>PT${INTERVAL_MINUTES}M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <StartBoundary>2026-01-01T00:00:00</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT10M</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>conhost.exe</Command>
      <Arguments>--headless ${xml(quoted(command))}</Arguments>
    </Exec>
  </Actions>
</Task>
`
}

export function launchdPlist(command) {
  const args = command.map((arg) => `    <string>${xml(arg)}</string>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>StartInterval</key>
  <integer>${INTERVAL_MINUTES * 60}</integer>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
`
}

export function systemdUnits(command) {
  return {
    service: `[Unit]\nDescription=Manaflow push\n\n[Service]\nType=oneshot\nExecStart=${quoted(command)}\n`,
    timer: `[Unit]\nDescription=Manaflow push every ${INTERVAL_MINUTES} minutes\n\n[Timer]\nOnBootSec=2min\nOnUnitActiveSec=${INTERVAL_MINUTES}min\n\n[Install]\nWantedBy=timers.target\n`,
  }
}

export function cronLine(command) {
  return `*/${INTERVAL_MINUTES} * * * * ${quoted(command)} ${CRON_MARKER}`
}

export function withoutCronLine(crontab) {
  return crontab
    .split('\n')
    .filter((line) => !line.includes(CRON_MARKER))
    .join('\n')
}

const plistPath = () => join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`)
const systemdDir = () => join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'systemd', 'user')
const hasSystemd = () => succeeds('systemctl', ['--user', 'show-environment'])
const currentCrontab = () => {
  try {
    return exec('crontab', ['-l'])
  } catch {
    return ''
  }
}

const windows = {
  install(command) {
    const file = join(tmpdir(), `manaflow-task-${process.pid}.xml`)
    writeFileSync(file, `﻿${windowsTaskXml(command)}`, 'utf16le')
    try {
      exec('schtasks', ['/Create', '/F', '/TN', TASK_NAME, '/XML', file])
    } finally {
      rmSync(file, { force: true })
    }
  },
  remove() {
    if (this.installed()) exec('schtasks', ['/Delete', '/F', '/TN', TASK_NAME])
  },
  installed: () => succeeds('schtasks', ['/Query', '/TN', TASK_NAME]),
  label: 'Task Scheduler',
}

const mac = {
  install(command) {
    const domain = `gui/${userInfo().uid}`
    mkdirSync(dirname(plistPath()), { recursive: true })
    writeFileSync(plistPath(), launchdPlist(command))
    succeeds('launchctl', ['bootout', domain, plistPath()])
    exec('launchctl', ['bootstrap', domain, plistPath()])
  },
  remove() {
    succeeds('launchctl', ['bootout', `gui/${userInfo().uid}`, plistPath()])
    rmSync(plistPath(), { force: true })
  },
  installed: () => existsSync(plistPath()),
  label: 'launchd',
}

const linux = {
  install(command) {
    if (!hasSystemd()) {
      exec('crontab', ['-'], { input: `${withoutCronLine(currentCrontab()).trimEnd()}\n${cronLine(command)}\n`.trimStart() })
      return
    }
    const units = systemdUnits(command)
    mkdirSync(systemdDir(), { recursive: true })
    writeFileSync(join(systemdDir(), `${UNIT}.service`), units.service)
    writeFileSync(join(systemdDir(), `${UNIT}.timer`), units.timer)
    exec('systemctl', ['--user', 'daemon-reload'])
    exec('systemctl', ['--user', 'enable', '--now', `${UNIT}.timer`])
  },
  remove() {
    if (existsSync(join(systemdDir(), `${UNIT}.timer`))) {
      succeeds('systemctl', ['--user', 'disable', '--now', `${UNIT}.timer`])
      rmSync(join(systemdDir(), `${UNIT}.service`), { force: true })
      rmSync(join(systemdDir(), `${UNIT}.timer`), { force: true })
      succeeds('systemctl', ['--user', 'daemon-reload'])
    }
    const crontab = currentCrontab()
    if (crontab.includes(CRON_MARKER)) exec('crontab', ['-'], { input: `${withoutCronLine(crontab).trimEnd()}\n` })
  },
  installed: () => existsSync(join(systemdDir(), `${UNIT}.timer`)) || currentCrontab().includes(CRON_MARKER),
  label: 'systemd timer / cron',
}

function scheduler() {
  const found = { win32: windows, darwin: mac, linux }[process.platform]
  if (!found) throw new UserError(`Jadwal otomatis belum didukung di ${process.platform}.`)
  return found
}

function guard(action) {
  try {
    return action()
  } catch (err) {
    if (err instanceof UserError) throw err
    throw new UserError(`Gagal mengatur jadwal: ${(err.stderr || err.message).toString().trim()}`)
  }
}

export const installSchedule = () => guard(() => scheduler().install(pushCommand()))
export const removeSchedule = () => guard(() => scheduler().remove())
export const scheduleInstalled = () => guard(() => scheduler().installed())
export const schedulerLabel = () => scheduler().label
