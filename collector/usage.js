import { createHash } from 'node:crypto'

// The periods codeburn's dashboard offers. The short ones move all day and go
// out on every push; the long ones barely change and are refreshed a few times
// a day, which keeps a scheduled run short.
export const FAST_PERIODS = ['today', 'week']
export const SLOW_PERIODS = ['30days', 'month', 'all', 'lifetime']
export const SLOW_REFRESH_MS = 6 * 60 * 60 * 1000
// Building a context tree re-reads a whole transcript (a few seconds each), so
// a run spends a bounded time on them and the backlog drains over several runs.
export const CONTEXT_BUDGET_MS = 45_000
// What the server accepts in one request.
export const CONTEXT_BATCH = 20

function baseName(path) {
  return String(path ?? '').split(/[\\/]/).filter(Boolean).at(-1) ?? ''
}

// The lifetime timeline starts decades before the first session, one empty
// point per day (about 2 MB). Only the stretch from the first activity matters.
function trimTimeline(history) {
  const points = history?.timeline?.points
  if (!points) return history
  const first = points.findIndex((point) => (point.cost ?? 0) > 0 || (point.tokens ?? 0) > 0)
  return { ...history, timeline: { ...history.timeline, points: first < 0 ? [] : points.slice(first) } }
}

// Removes what manaflow does not collect from a codeburn usage payload: branch
// names, PR links, live sessions, and local directory paths.
export function stripUsagePayload(payload) {
  const { liveSessions: _live, telemetrySnapshot: _telemetry, claudeConfigs: _configs, ...rest } = payload
  const { byBranch: _branches, pullRequests: _prs, ...current } = payload.current ?? {}
  return {
    ...rest,
    history: trimTimeline(payload.history),
    current: {
      ...current,
      topProjects: (current.topProjects ?? []).map(({ id: _id, ...project }) => project),
      topSessions: (current.topSessions ?? []).map((session) => ({ ...session, project: baseName(session.project) })),
      topReworkedFiles: (current.topReworkedFiles ?? []).map((file) => ({ ...file, path: baseName(file.path) })),
    },
  }
}

export function stripContextTree(tree) {
  const { filePath: _path, ...session } = tree.session ?? {}
  return { ...tree, session }
}

// `generated` changes on every run, so it is left out of the comparison.
export function payloadFingerprint(payload) {
  const { generated: _generated, ...stable } = payload
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex')
}

export function duePeriods(sentAt, now = Date.now()) {
  const slow = SLOW_PERIODS.filter((period) => now - (sentAt[period] ?? 0) >= SLOW_REFRESH_MS)
  return [...FAST_PERIODS, ...slow]
}

// codeburn's durable daily cache can end up with whole days missing while still
// marked complete, and everything built from it then under-reports. `daily` is
// the per-provider figure, which is parsed fresh; a day it knows that the
// payload history lacks or disagrees with means the cache must be rebuilt.
export function historyIsStale(payload, daily) {
  const history = new Map((payload.history?.daily ?? []).map((day) => [day.date, day.cost ?? 0]))
  return daily.some((day) => {
    if ((day.cost ?? 0) < 0.01) return false
    const cached = history.get(day.date)
    return cached === undefined || Math.abs(cached - day.cost) > Math.max(0.01, day.cost * 0.02)
  })
}

const CONTEXT_PROVIDERS = new Set(['claude', 'codex'])

export function contextKey(session) {
  return `${session.provider}:${session.sessionId}`
}

// A session's tree only changes when the session does.
export function contextMarker(session) {
  return `${session.endedAt}|${session.calls}`
}

// Every session codeburn can build a tree for whose tree is missing or out of
// date on the server, newest first. `sessions` are codeburn session rows, so
// this covers the whole collection window rather than the few recent sessions
// `codeburn context --list` offers.
export function pendingContextSessions(sessions, sentMarkers) {
  return sessions
    .filter((session) => CONTEXT_PROVIDERS.has(session.provider))
    .filter((session) => sentMarkers[contextKey(session)] !== contextMarker(session))
    .sort((a, b) => String(b.endedAt).localeCompare(String(a.endedAt)))
}
