export type Period = 'today' | 'week' | '30days' | 'month' | 'all' | 'lifetime'

export type ModelDay = {
  name: string
  cost: number
  calls: number
  inputTokens: number
  outputTokens: number
}

export type DailyEntry = {
  date: string
  cost: number
  calls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  topModels: ModelDay[]
}

export type GranularSeries = { id: string; label: string }
export type GranularValue = { seriesId: string; cost: number; tokens: number }
export type GranularPoint = {
  timestamp: string
  cost: number
  tokens: number
  models: GranularValue[]
  sessions: GranularValue[]
}
export type GranularHistory = {
  bucketMinutes: number
  modelSeries: GranularSeries[]
  sessionSeries: GranularSeries[]
  points: GranularPoint[]
}

export type Current = {
  label: string
  cost: number
  calls: number
  sessions: number
  sessionCountBasis?: 'identity' | 'partial'
  oneShotRate: number | null
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cacheHitPercent: number
  codexCredits: number
  topActivities: Array<{ name: string; cost: number; turns: number; oneShotRate: number | null }>
  topModels: Array<{ name: string; cost: number; calls: number; savingsUSD: number }>
  providers: Record<string, number>
  topProjects: Array<{ name: string; cost: number; sessions: number; avgCostPerSession?: number; sessionCountBasis?: 'identity' | 'partial' }>
  tools: Array<{ name: string; calls: number }>
  subagents: Array<{ name: string; calls: number; cost: number }>
  skills: Array<{ name: string; turns: number; cost: number }>
  mcpServers: Array<{ name: string; calls: number }>
  modelEfficiency: Array<{ name: string; costPerEdit: number; oneShotRate: number }>
  // Workflow-intelligence rollup for the period. Optional: an older peer's
  // payload predates the block, and the Workflow panel hides when it is absent.
  workflow?: { corrections: number; correctionRate: number | null; medianTimeToFirstEditMs: number | null }
  // Files most reworked by edit-family calls (top 8), basenames only.
  topReworkedFiles?: Array<{ path: string; sessions: number; edits: number }>
  // Share (0-1) of cost-bearing calls that resolved a price. null when not
  // computable; "unknown" must never render as 100% coverage.
  pricingCoverage?: number | null
  // Models with recorded usage whose cost prices at $0 for lack of pricing
  // data — usage ran, the figure is unknown, not zero. Absent on older
  // payloads; absent or empty -> the models panel shows no unpriced line.
  unpricedModels?: Array<{ model: string; calls: number; tokens: number }>
  localModelSavings: { totalUSD: number }
  retryTax: { totalUSD: number; retries: number }
  routingWaste: { totalSavingsUSD: number }
}

export type Payload = {
  generated: string
  // Only a producer that its clients poll (the resident serve child) ever sends
  // this, and only it may answer partially. `complete: false` means the totals
  // cover the files indexed so far. Absence must be read as complete.
  hydration?: { complete: boolean; indexedFiles: number; totalFiles: number }
  current: Current
  history: { daily: DailyEntry[]; timeline?: GranularHistory }
}

const TOKEN_KEY = 'manaflow.token'

// The dashboard token is shared with the team page, which owns the login form.
function token(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

async function get(path: string): Promise<Response> {
  const res = await fetch(path, { headers: { authorization: `Bearer ${token()}` } })
  if (res.status === 401) {
    location.href = '../'
    throw new Error('Not signed in')
  }
  return res
}

export type DeviceUsage = {
  id: string
  name: string
  local: boolean
  payload?: Payload
  error?: string
}

export type Person = {
  // The device this entry opens; a member with two laptops appears twice.
  deviceId: string
  memberId: number
  name: string
  position: string
  deviceName: string
  lastSeen: string
}

export async function fetchPeople(): Promise<Person[]> {
  const res = await get('/v1/people')
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  const data = (await res.json()) as {
    members: Array<{ id: number; name: string; position: string }>
    devices: Array<{ id: string; memberId: number; name: string; lastSeen: string }>
  }
  const members = new Map(data.members.map((m) => [m.id, m]))
  return data.devices
    .map((d) => ({
      deviceId: d.id,
      memberId: d.memberId,
      name: members.get(d.memberId)?.name ?? '—',
      position: members.get(d.memberId)?.position ?? '',
      deviceName: d.name,
      lastSeen: d.lastSeen,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.deviceName.localeCompare(b.deviceName))
}

export type DevicePayload = { updatedAt: string; payload?: Payload }

export async function fetchDeviceUsage(deviceId: string, period: Period): Promise<DevicePayload | null> {
  const res = await get(`/v1/usage?device=${encodeURIComponent(deviceId)}&period=${encodeURIComponent(period)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  const data = (await res.json()) as { updatedAt: string; payload: Payload }
  return { updatedAt: data.updatedAt, payload: normalizePayload(data.payload) }
}

// A device may run a different CodeBurn version and send a payload missing
// fields we treat as required. Fill safe defaults at the boundary so the UI
// can iterate them without crashing (the alternative is a white screen for an
// innocent local user because a peer sent an old shape).
function normalizePayload(p?: Payload): Payload | undefined {
  if (!p) return p
  const c = (p.current ?? {}) as Partial<Current>
  const rawTimeline = p.history?.timeline
  const timeline = rawTimeline ? {
    bucketMinutes: rawTimeline.bucketMinutes ?? 1440,
    modelSeries: rawTimeline.modelSeries ?? [],
    sessionSeries: rawTimeline.sessionSeries ?? [],
    points: (rawTimeline.points ?? []).map((point) => ({
      timestamp: point.timestamp,
      cost: point.cost ?? 0,
      tokens: point.tokens ?? 0,
      models: (point.models ?? []).map((value) => ({
        seriesId: value.seriesId,
        cost: value.cost ?? 0,
        tokens: value.tokens ?? 0,
      })),
      sessions: (point.sessions ?? []).map((value) => ({
        seriesId: value.seriesId,
        cost: value.cost ?? 0,
        tokens: value.tokens ?? 0,
      })),
    })),
  } : undefined
  return {
    generated: p.generated,
    ...(p.hydration ? { hydration: p.hydration } : {}),
    current: {
      label: c.label ?? '',
      cost: c.cost ?? 0,
      calls: c.calls ?? 0,
      sessions: c.sessions ?? 0,
      oneShotRate: c.oneShotRate ?? null,
      inputTokens: c.inputTokens ?? 0,
      outputTokens: c.outputTokens ?? 0,
      cacheReadTokens: c.cacheReadTokens ?? 0,
      cacheWriteTokens: c.cacheWriteTokens ?? 0,
      cacheHitPercent: c.cacheHitPercent ?? 0,
      codexCredits: c.codexCredits ?? 0,
      topActivities: c.topActivities ?? [],
      topModels: c.topModels ?? [],
      providers: c.providers ?? {},
      topProjects: c.topProjects ?? [],
      tools: c.tools ?? [],
      subagents: c.subagents ?? [],
      skills: c.skills ?? [],
      mcpServers: c.mcpServers ?? [],
      modelEfficiency: c.modelEfficiency ?? [],
      workflow: c.workflow
        ? {
            corrections: c.workflow.corrections ?? 0,
            correctionRate: c.workflow.correctionRate ?? null,
            medianTimeToFirstEditMs: c.workflow.medianTimeToFirstEditMs ?? null,
          }
        : undefined,
      topReworkedFiles: (c.topReworkedFiles ?? []).map((f) => ({
        path: f.path,
        sessions: f.sessions ?? 0,
        edits: f.edits ?? 0,
      })),
      pricingCoverage: c.pricingCoverage ?? null,
      unpricedModels: c.unpricedModels ?? [],
      localModelSavings: c.localModelSavings ?? { totalUSD: 0 },
      retryTax: c.retryTax ?? { totalUSD: 0, retries: 0 },
      routingWaste: c.routingWaste ?? { totalSavingsUSD: 0 },
    },
    history: {
      daily: (p.history?.daily ?? []).map((d) => ({
        date: d.date,
        cost: d.cost ?? 0,
        calls: d.calls ?? 0,
        inputTokens: d.inputTokens ?? 0,
        outputTokens: d.outputTokens ?? 0,
        cacheReadTokens: d.cacheReadTokens ?? 0,
        cacheWriteTokens: d.cacheWriteTokens ?? 0,
        topModels: (d.topModels ?? []).map((m) => ({
          name: m.name,
          cost: m.cost ?? 0,
          calls: m.calls ?? 0,
          inputTokens: m.inputTokens ?? 0,
          outputTokens: m.outputTokens ?? 0,
        })),
      })),
      ...(timeline ? { timeline } : {}),
    },
  }
}

// Keys map 1:1 to the CLI's --period values (src/cli-date.ts). Period windows
// are computed server-side by the CLI; the dashboard only forwards the key, so
// these can never drift from the CLI's totals.
export const PERIODS: Array<{ key: Period; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: '7 days' },
  { key: '30days', label: '30 days' },
  { key: 'month', label: 'Month' },
  { key: 'all', label: '6 months' },
  { key: 'lifetime', label: 'Lifetime' },
]

export type ContextProvider = 'claude' | 'codex'

export type ContextSessionInfo = {
  provider: ContextProvider
  sessionId: string
  project: string
  title: string
  mtimeMs: number
  sizeBytes: number
}

export type BlockStat = { count: number; tokens: number }

export type ContextSnapshot = {
  messages: number
  tokens: number
  assistant: {
    count: number
    tokens: number
    text: BlockStat
    reasoning: BlockStat
    toolCall: BlockStat
    byTool: Array<{ tool: string; count: number; tokens: number }>
  }
  user: {
    count: number
    tokens: number
    text: BlockStat
    image: BlockStat
    compactSummary: BlockStat
    meta: BlockStat
  }
  toolResult: BlockStat
  system: BlockStat
}

export type ContextRow = { depth: number; label: string; count: number; tokens: number; bold?: boolean }

export type ContextTree = {
  session: { sessionId: string; project: string; mtimeMs: number; sizeBytes: number }
  model: string
  compactions: number
  reported: { context: number; window: number | null } | null
  effective: ContextSnapshot
  full: ContextSnapshot
  effectiveRows: ContextRow[]
  fullRows: ContextRow[]
}

// The collector stores the tree as the codeburn CLI prints it, without the
// display rows codeburn's own web server adds; they are derived here the same way.
function snapshotRows(view: ContextSnapshot): ContextRow[] {
  const rows: ContextRow[] = []
  rows.push({ depth: 0, label: 'assistant', count: view.assistant.count, tokens: view.assistant.tokens, bold: true })
  rows.push({ depth: 1, label: 'text', count: view.assistant.text.count, tokens: view.assistant.text.tokens })
  if (view.assistant.reasoning.count > 0) rows.push({ depth: 1, label: 'reasoning', count: view.assistant.reasoning.count, tokens: view.assistant.reasoning.tokens })
  rows.push({ depth: 1, label: 'tool-call', count: view.assistant.toolCall.count, tokens: view.assistant.toolCall.tokens })
  for (const t of view.assistant.byTool) rows.push({ depth: 2, label: t.tool, count: t.count, tokens: t.tokens })
  rows.push({ depth: 0, label: 'user', count: view.user.count, tokens: view.user.tokens, bold: true })
  rows.push({ depth: 1, label: 'text', count: view.user.text.count, tokens: view.user.text.tokens })
  if (view.user.image.count > 0) rows.push({ depth: 1, label: 'image', count: view.user.image.count, tokens: view.user.image.tokens })
  if (view.user.compactSummary.count > 0) rows.push({ depth: 1, label: 'compact-summary', count: view.user.compactSummary.count, tokens: view.user.compactSummary.tokens })
  if (view.user.meta.count > 0) rows.push({ depth: 1, label: 'meta', count: view.user.meta.count, tokens: view.user.meta.tokens })
  rows.push({ depth: 0, label: 'tool', count: view.toolResult.count, tokens: view.toolResult.tokens, bold: true })
  rows.push({ depth: 1, label: 'tool-result', count: view.toolResult.count, tokens: view.toolResult.tokens })
  if (view.system.count > 0) rows.push({ depth: 0, label: 'system', count: view.system.count, tokens: view.system.tokens, bold: true })
  return rows
}

export async function fetchContextSessions(deviceId: string, provider: ContextProvider): Promise<ContextSessionInfo[]> {
  const res = await get(`/v1/context/sessions?device=${encodeURIComponent(deviceId)}&provider=${encodeURIComponent(provider)}`)
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  const json = (await res.json()) as { sessions: ContextSessionInfo[] }
  return json.sessions ?? []
}

export async function fetchContextTree(deviceId: string, provider: ContextProvider, id: string): Promise<ContextTree> {
  const res = await get(
    `/v1/context/tree?device=${encodeURIComponent(deviceId)}&provider=${encodeURIComponent(provider)}&id=${encodeURIComponent(id)}`,
  )
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  const tree = (await res.json()) as Omit<ContextTree, 'effectiveRows' | 'fullRows'>
  return { ...tree, effectiveRows: snapshotRows(tree.effective), fullRows: snapshotRows(tree.full) }
}
