import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'

import { CHECK_INTERVAL_MS, dueForCheck, isNewer, isNpmInstall } from '../update.js'

test('a version is newer only when a numeric part is higher', () => {
  assert.equal(isNewer('0.2.1', '0.2.0'), true)
  assert.equal(isNewer('0.10.0', '0.9.9'), true)
  assert.equal(isNewer('1.0.0', '0.99.99'), true)
  assert.equal(isNewer('0.2.0', '0.2.0'), false)
  assert.equal(isNewer('0.1.9', '0.2.0'), false)
  assert.equal(isNewer('garbage', '0.2.0'), false)
})

test('the version check runs at most once a day', () => {
  const now = 10 * CHECK_INTERVAL_MS
  assert.equal(dueForCheck(undefined, now), true)
  assert.equal(dueForCheck(now - CHECK_INTERVAL_MS, now), true)
  assert.equal(dueForCheck(now - CHECK_INTERVAL_MS + 1000, now), false)
})

test('only a copy under node_modules counts as an npm install', () => {
  assert.equal(isNpmInstall(join('C:', 'Users', 'a', 'AppData', 'Roaming', 'npm', 'node_modules', 'manaflow', 'collector')), true)
  assert.equal(isNpmInstall(join('E:', 'work', 'manaflow', 'collector')), false)
  assert.equal(isNpmInstall(), false, 'the test runs from a git checkout')
})
