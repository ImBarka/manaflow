import { test } from 'node:test'
import assert from 'node:assert/strict'

import { chunk, dayRollups, diff, mergeDaily, mergeSegments, toDay, toSession } from '../payload.js'

const row = {
  sessionId: 'abc',
  provider: 'claude',
  title: 'Fix login bug',
  project: 'webapp',
  projectId: 'C:/Users/someone/webapp',
  models: ['Opus 5'],
  cost: 3.1234567891,
  savingsUSD: 0,
  calls: 12,
  turns: 5,
  inputTokens: 100,
  outputTokens: 200,
  cacheReadTokens: 3000,
  cacheWriteTokens: 400,
  startedAt: '2026-10-06T01:00:00.000Z',
  endedAt: '2026-10-06T02:00:00.000Z',
  durationMs: 3600000,
  contributions: {
    segments: [
      { day: '2026-10-06', category: 'coding', branch: 'feat/secret-client', prs: ['acme/app#12'], models: { 'Opus 5': 1 }, modelUsage: { 'Opus 5': { calls: 4, inputTokens: 40, outputTokens: 80 } } },
      { day: '2026-10-06', category: 'coding', branch: 'main', prs: [], models: { 'Opus 5': 2, 'Sonnet 5.5': 0.5 }, modelUsage: { 'Opus 5': { calls: 6, inputTokens: 50, outputTokens: 100 }, 'Sonnet 5.5': { calls: 2, inputTokens: 10, outputTokens: 20 } } },
      { day: '2026-10-06', category: 'debugging', branch: 'main', prs: [], models: { 'Opus 5': 0.25 }, modelUsage: { 'Opus 5': { calls: 1, inputTokens: 5, outputTokens: 5 } } },
    ],
  },
}

test('segments merge by day and category and sum per model', () => {
  const merged = mergeSegments(row.contributions.segments)
  assert.equal(merged.length, 2)
  const coding = merged.find((s) => s.category === 'coding')
  assert.deepEqual(coding.models['Opus 5'], { cost: 3, calls: 10, inputTokens: 90, outputTokens: 180 })
  assert.deepEqual(coding.models['Sonnet 5.5'], { cost: 0.5, calls: 2, inputTokens: 10, outputTokens: 20 })
})

test('branch names, PR links and local paths never reach the payload', () => {
  const sent = JSON.stringify(toSession(row))
  assert.ok(!sent.includes('secret-client'))
  assert.ok(!sent.includes('acme/app'))
  assert.ok(!sent.includes('C:/Users'))
})

test('a session maps to the server field names', () => {
  const session = toSession(row)
  assert.equal(session.sessionId, 'abc')
  assert.equal(session.cost, 3.123457)
  assert.equal(session.cacheReadTokens, 3000)
})

test('a report day maps to the server field names', () => {
  assert.deepEqual(toDay({ date: '2026-10-06', cost: 1.5, savings: 0, calls: 3, turns: 2, editTurns: 1, oneShotTurns: 1, oneShotRate: 100 }), {
    day: '2026-10-06',
    cost: 1.5,
    calls: 3,
    turns: 2,
    editTurns: 1,
    oneShotTurns: 1,
    sessions: 0,
    sessionsStarted: 0,
    breakdown: [],
  })
})

test('daily rows from several providers sum into one row per date', () => {
  const merged = mergeDaily([
    [{ date: '2026-10-06', cost: 1, calls: 2, turns: 1, editTurns: 1, oneShotTurns: 1 }],
    [
      { date: '2026-10-05', cost: 4, calls: 1, turns: 1, editTurns: 0, oneShotTurns: 0 },
      { date: '2026-10-06', cost: 0.5, calls: 3, turns: 2, editTurns: 2, oneShotTurns: 1 },
    ],
  ])
  assert.deepEqual(merged, [
    { date: '2026-10-05', cost: 4, calls: 1, turns: 1, editTurns: 0, oneShotTurns: 0 },
    { date: '2026-10-06', cost: 1.5, calls: 5, turns: 3, editTurns: 3, oneShotTurns: 2 },
  ])
})

test('diff sends everything the first time and nothing when unchanged', () => {
  const sessions = [toSession(row)]
  const days = [toDay({ date: '2026-10-06', cost: 1, calls: 1 })]
  const first = diff(sessions, days, {})
  assert.equal(first.changedSessions.length, 1)
  assert.equal(first.changedDays.length, 1)

  const second = diff(sessions, days, first.seen)
  assert.equal(second.changedSessions.length, 0)
  assert.equal(second.changedDays.length, 0)
})

test('diff resends a session that grew and forgets ones outside the window', () => {
  const first = diff([toSession(row)], [], { 's:claude:old-session': 'x' })
  assert.ok(!('s:claude:old-session' in first.seen))

  const grown = diff([toSession({ ...row, calls: 13 })], [], first.seen)
  assert.equal(grown.changedSessions.length, 1)
})

test('chunk splits into batches of the given size', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
  assert.deepEqual(chunk([], 2), [])
})

test('days are rolled up per tool, model and category, with session counts', () => {
  const model = (cost, calls) => ({ cost, calls, inputTokens: calls, outputTokens: calls * 2 })
  const sessions = [
    {
      provider: 'claude',
      segments: [
        { day: '2026-10-05', category: 'coding', models: { 'Opus 5': model(2, 4) } },
        { day: '2026-10-06', category: 'coding', models: { 'Opus 5': model(1, 1), 'Sonnet 5.5': model(0.5, 2) } },
      ],
    },
    { provider: 'claude', segments: [{ day: '2026-10-06', category: 'coding', models: { 'Opus 5': model(3, 5) } }] },
    { provider: 'codex', segments: [{ day: '2026-10-06', category: 'debugging', models: { 'gpt-5': model(4, 1) } }] },
  ]
  const rollups = dayRollups(sessions)

  assert.deepEqual({ ...rollups.get('2026-10-05'), breakdown: undefined }, { sessions: 1, sessionsStarted: 1, breakdown: undefined })
  const day = rollups.get('2026-10-06')
  // The first session began the day before, so it is active here but not started here.
  assert.deepEqual([day.sessions, day.sessionsStarted], [3, 2])
  assert.deepEqual(day.breakdown, [
    { provider: 'claude', model: 'Opus 5', category: 'coding', account: '', cost: 4, calls: 6, inputTokens: 6, outputTokens: 12 },
    { provider: 'codex', model: 'gpt-5', category: 'debugging', account: '', cost: 4, calls: 1, inputTokens: 1, outputTokens: 2 },
    { provider: 'claude', model: 'Sonnet 5.5', category: 'coding', account: '', cost: 0.5, calls: 2, inputTokens: 2, outputTokens: 4 },
  ])
})

test('a day carries its rollup and token counts, and omits the tokens when unknown', () => {
  const row = { date: '2026-10-06', cost: 1.5, calls: 3, turns: 2, editTurns: 1, oneShotTurns: 1 }
  const rollup = { sessions: 2, sessionsStarted: 1, breakdown: [{ provider: 'claude', model: 'Opus 5', category: 'coding', cost: 1.5, calls: 3, inputTokens: 1, outputTokens: 2 }] }
  const withTokens = toDay(row, rollup, { date: '2026-10-06', inputTokens: 10, cacheReadTokens: 990, cost: 1.5 })
  assert.deepEqual([withTokens.sessions, withTokens.sessionsStarted, withTokens.inputTokens, withTokens.cacheReadTokens], [2, 1, 10, 990])
  assert.deepEqual(withTokens.breakdown, rollup.breakdown)
  const without = toDay(row, rollup, undefined)
  assert.ok(!('inputTokens' in without) && !('cacheReadTokens' in without))
})

test('days are rolled up per account too, and sessions without a mark stay separate', () => {
  const model = (cost) => ({ cost, calls: 1, inputTokens: 1, outputTokens: 1 })
  const seg = (cost) => [{ day: '2026-10-06', category: 'coding', models: { 'Opus 5': model(cost) } }]
  const sessions = [
    { provider: 'claude', sessionId: 'a', segments: seg(2) },
    { provider: 'claude', sessionId: 'b', segments: seg(3) },
    { provider: 'claude', sessionId: 'c', segments: seg(5) },
    { provider: 'claude', sessionId: 'd', segments: seg(7) },
  ]
  const marks = { 'claude:a': 'acc1', 'claude:b': 'acc1', 'claude:c': 'acc2' }
  const rows = dayRollups(sessions, marks).get('2026-10-06').breakdown
  const byAccount = Object.fromEntries(rows.map((row) => [row.account, [row.cost, row.calls]]))
  assert.deepEqual(byAccount, { '': [7, 1], acc1: [5, 2], acc2: [5, 1] })
})
