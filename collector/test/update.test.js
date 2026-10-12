import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'

import { CHECK_INTERVAL_MS, dueForCheck, isNewer, isNpmInstall, newestRelease } from '../update.js'

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

test('the newest release is the highest vX.Y.Z tag, ignoring anything else', () => {
  assert.equal(newestRelease(['v0.2.1', 'v0.10.0', 'v0.9.3', 'nightly', 'v1.0', 'release-2', 'v0.2.1-beta']), '0.10.0')
  assert.equal(newestRelease(['main', 'wip']), null)
  assert.equal(newestRelease([]), null)
})
