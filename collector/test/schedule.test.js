import { test } from 'node:test'
import assert from 'node:assert/strict'

import { cronLine, launchdPlist, systemdUnits, windowsTaskXml, withoutCronLine } from '../schedule.js'

const spaced = ['C:\\Program Files\\nodejs\\node.exe', 'C:\\Users\\some user\\manaflow\\collector\\cli.js', 'push', '--log']
const plain = ['/usr/bin/node', '/opt/manaflow/collector/cli.js', 'push', '--log']

test('windows task quotes paths with spaces and is allowed to run on battery', () => {
  const task = windowsTaskXml(spaced)
  assert.ok(
    task.includes(
      '<Arguments>--headless "C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\some user\\manaflow\\collector\\cli.js" push --log</Arguments>',
    ),
  )
  assert.ok(task.includes('<Interval>PT30M</Interval>'))
  assert.ok(task.includes('<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>'))
  assert.ok(task.includes('<StartWhenAvailable>true</StartWhenAvailable>'))
})

test('launchd plist runs every 30 minutes and escapes XML', () => {
  const plist = launchdPlist(['/usr/bin/node', '/Users/a&b/cli.js', 'push', '--log'])
  assert.match(plist, /<integer>1800<\/integer>/)
  assert.match(plist, /<string>\/Users\/a&amp;b\/cli\.js<\/string>/)
  assert.match(plist, /<string>com\.manaflow\.push<\/string>/)
})

test('systemd units run the push every 30 minutes', () => {
  const units = systemdUnits(plain)
  assert.match(units.service, /^ExecStart=\/usr\/bin\/node \/opt\/manaflow\/collector\/cli\.js push --log$/m)
  assert.match(units.timer, /^OnUnitActiveSec=30min$/m)
})

test('cron line can be added and removed without touching other entries', () => {
  const line = cronLine(plain)
  assert.equal(line, '*/30 * * * * /usr/bin/node /opt/manaflow/collector/cli.js push --log # manaflow')
  const crontab = `0 3 * * * /usr/bin/backup\n${line}\n`
  assert.equal(withoutCronLine(crontab).trim(), '0 3 * * * /usr/bin/backup')
})
