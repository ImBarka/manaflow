export const MAX_SESSIONS_PER_REQUEST = 50

function round(value, digits) {
  const factor = 10 ** digits
  return Math.round((Number(value) || 0) * factor) / factor
}

// codeburn splits a session by day, category, branch and PR. Branch and PR
// names are not part of what manaflow collects, so segments are merged down to
// day + category with a per-model breakdown.
export function mergeSegments(segments) {
  const merged = new Map()
  for (const seg of segments ?? []) {
    const key = `${seg.day}|${seg.category}`
    let target = merged.get(key)
    if (!target) {
      target = { day: seg.day, category: seg.category, models: {} }
      merged.set(key, target)
    }
    for (const [name, cost] of Object.entries(seg.models ?? {})) {
      const usage = seg.modelUsage?.[name] ?? {}
      const model = (target.models[name] ??= { cost: 0, calls: 0, inputTokens: 0, outputTokens: 0 })
      model.cost += Number(cost) || 0
      model.calls += usage.calls ?? 0
      model.inputTokens += usage.inputTokens ?? 0
      model.outputTokens += usage.outputTokens ?? 0
    }
  }
  for (const seg of merged.values()) {
    for (const model of Object.values(seg.models)) model.cost = round(model.cost, 6)
  }
  return [...merged.values()]
}

export function toSession(row) {
  return {
    sessionId: row.sessionId,
    provider: row.provider,
    title: row.title ?? '',
    project: row.project ?? '',
    models: row.models ?? [],
    cost: round(row.cost, 6),
    calls: row.calls ?? 0,
    turns: row.turns ?? 0,
    inputTokens: row.inputTokens ?? 0,
    outputTokens: row.outputTokens ?? 0,
    cacheReadTokens: row.cacheReadTokens ?? 0,
    cacheWriteTokens: row.cacheWriteTokens ?? 0,
    startedAt: row.startedAt ?? '',
    endedAt: row.endedAt ?? '',
    durationMs: row.durationMs ?? 0,
    segments: mergeSegments(row.contributions?.segments),
  }
}

// Sums codeburn report days across providers into one row per date.
export function mergeDaily(dailyLists) {
  const byDate = new Map()
  for (const row of dailyLists.flat()) {
    const day = byDate.get(row.date) ?? { date: row.date, cost: 0, calls: 0, turns: 0, editTurns: 0, oneShotTurns: 0 }
    day.cost += row.cost ?? 0
    day.calls += row.calls ?? 0
    day.turns += row.turns ?? 0
    day.editTurns += row.editTurns ?? 0
    day.oneShotTurns += row.oneShotTurns ?? 0
    byDate.set(row.date, day)
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export function toDay(row) {
  return {
    day: row.date,
    cost: round(row.cost, 6),
    calls: row.calls ?? 0,
    turns: row.turns ?? 0,
    editTurns: row.editTurns ?? 0,
    oneShotTurns: row.oneShotTurns ?? 0,
  }
}

export function sessionKey(session) {
  return `s:${session.provider}:${session.sessionId}`
}

export function dayKey(day) {
  return `d:${day.day}`
}

function fingerprint(item) {
  return JSON.stringify(item)
}

// Returns what still has to be sent, plus the fingerprints to remember once the
// send succeeds. Items that left the collection window drop out of `seen`, so
// the state file does not grow without bound.
export function diff(sessions, days, sent) {
  const seen = {}
  const changedSessions = []
  const changedDays = []
  for (const session of sessions) {
    const key = sessionKey(session)
    seen[key] = fingerprint(session)
    if (sent[key] !== seen[key]) changedSessions.push(session)
  }
  for (const day of days) {
    const key = dayKey(day)
    seen[key] = fingerprint(day)
    if (sent[key] !== seen[key]) changedDays.push(day)
  }
  return { changedSessions, changedDays, seen }
}

export function chunk(items, size) {
  const chunks = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}
