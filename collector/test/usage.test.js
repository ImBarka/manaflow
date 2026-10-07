import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  SLOW_REFRESH_MS,
  contextKey,
  contextMarker,
  duePeriods,
  historyIsStale,
  payloadFingerprint,
  pendingContextSessions,
  stripContextTree,
  stripUsagePayload,
} from '../usage.js'

const payload = {
  generated: '2026-10-07T00:00:00Z',
  liveSessions: { sessions: [{ project: 'secret-client', branch: 'feat/x' }] },
  telemetrySnapshot: { anything: true },
  claudeConfigs: { options: [{ path: 'C:\\Users\\someone\\.claude' }] },
  current: {
    cost: 12.5,
    byBranch: [{ branch: 'feat/secret-client', cost: 1 }],
    pullRequests: { rows: [{ url: 'https://github.com/acme/app/pull/1' }] },
    topProjects: [{ id: 'C:\\Users\\someone\\work\\webapp', name: 'webapp', cost: 5 }],
    topSessions: [{ project: 'C:\\Users\\someone\\work\\webapp', cost: 2, sessionId: 's1' }],
    topReworkedFiles: [{ path: '/home/someone/work/webapp/src/login.ts', edits: 4 }],
  },
  history: { daily: [{ date: '2026-10-06', cost: 10 }] },
}

test('usage payload loses branches, PRs, live sessions and directory paths', () => {
  const stripped = stripUsagePayload(payload)
  const text = JSON.stringify(stripped)
  for (const leak of ['secret-client', 'acme/app', 'someone', 'telemetrySnapshot']) assert.ok(!text.includes(leak), leak)
  assert.equal(stripped.current.cost, 12.5)
  assert.deepEqual(stripped.current.topProjects, [{ name: 'webapp', cost: 5 }])
  assert.equal(stripped.current.topSessions[0].project, 'webapp')
  assert.equal(stripped.current.topReworkedFiles[0].path, 'login.ts')
  assert.deepEqual(stripped.history, payload.history)
})

test('the timeline is cut to start at the first activity', () => {
  const points = [
    { timestamp: 'a', cost: 0, tokens: 0 },
    { timestamp: 'b', cost: 0, tokens: 0 },
    { timestamp: 'c', cost: 2, tokens: 10 },
    { timestamp: 'd', cost: 0, tokens: 0 },
  ]
  const stripped = stripUsagePayload({ ...payload, history: { daily: [], timeline: { bucketMinutes: 1440, points } } })
  assert.deepEqual(stripped.history.timeline.points.map((p) => p.timestamp), ['c', 'd'])
  assert.equal(stripped.history.timeline.bucketMinutes, 1440)
})

test('context tree loses the local transcript path', () => {
  const tree = { model: 'Opus 5', session: { sessionId: 's1', filePath: 'C:\\Users\\someone\\.claude\\s1.jsonl', project: 'webapp' } }
  assert.deepEqual(stripContextTree(tree), { model: 'Opus 5', session: { sessionId: 's1', project: 'webapp' } })
})

test('fingerprint ignores the generation timestamp but not the numbers', () => {
  const base = payloadFingerprint(payload)
  assert.equal(payloadFingerprint({ ...payload, generated: 'later' }), base)
  assert.notEqual(payloadFingerprint({ ...payload, current: { ...payload.current, cost: 13 } }), base)
})

test('short periods are always due, long ones only after the refresh interval', () => {
  const now = 10 * SLOW_REFRESH_MS
  assert.deepEqual(duePeriods({}, now), ['today', 'week', '30days', 'month', 'all', 'lifetime'])
  assert.deepEqual(duePeriods({ '30days': now - 1000, month: now - 1000, all: now - SLOW_REFRESH_MS, lifetime: now - 1000 }, now), ['today', 'week', 'all'])
})

test('a day missing from or disagreeing with the payload history marks the cache stale', () => {
  const fresh = [{ date: '2026-10-06', cost: 10 }]
  assert.equal(historyIsStale(payload, fresh), false)
  assert.equal(historyIsStale(payload, [{ date: '2026-10-06', cost: 10.1 }]), false)
  assert.equal(historyIsStale(payload, [{ date: '2026-10-06', cost: 20 }]), true)
  assert.equal(historyIsStale(payload, [...fresh, { date: '2026-09-30', cost: 76 }]), true)
  assert.equal(historyIsStale(payload, [...fresh, { date: '2026-09-29', cost: 0 }]), false)
})

test('every claude and codex session without an up-to-date tree is pending, newest first', () => {
  const sessions = [
    { provider: 'claude', sessionId: 'a', endedAt: '2026-10-01T00:00:00Z', calls: 5 },
    { provider: 'claude', sessionId: 'b', endedAt: '2026-10-05T00:00:00Z', calls: 9 },
    { provider: 'codex', sessionId: 'c', endedAt: '2026-10-03T00:00:00Z', calls: 2 },
    { provider: 'antigravity', sessionId: 'd', endedAt: '2026-10-06T00:00:00Z', calls: 1 },
  ]
  const markers = { [contextKey(sessions[0])]: contextMarker(sessions[0]), [contextKey(sessions[1])]: '2026-10-04T00:00:00Z|7' }
  assert.deepEqual(pendingContextSessions(sessions, markers).map((s) => s.sessionId), ['b', 'c'])
  assert.deepEqual(pendingContextSessions(sessions, {}).map((s) => s.sessionId), ['b', 'c', 'a'])
})
