import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'

import {
  fetchDeviceUsage,
  fetchPeople,
  PERIODS,
  type Payload,
  type Period,
} from '@/lib/api'
import { cn, fmtNum, fmtTokens, formatSessionCount, usd } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { MetricCard } from '@/components/MetricCard'
import { BarList, type BarItem } from '@/components/BarList'
import { DataTable } from '@/components/DataTable'
import { GranularUsageChart, type Unit } from '@/components/UsageChart'
import { ContextExplorer } from '@/components/ContextExplorer'
import { WorkflowPanel, hasWorkflowContent } from '@/components/WorkflowPanel'
import { Punchcard } from '@/components/Punchcard'

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="px-5 py-4">
      <h2 className="mb-3.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-heading">{title}</h2>
      {children}
    </Card>
  )
}

function SideLink({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13.5px] transition-colors max-md:min-h-9',
        active ? 'bg-interactive-secondary font-medium text-foreground' : 'font-light text-muted-foreground hover:text-foreground',
      )}
    >
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', active ? 'bg-primary' : 'bg-transparent')} />
      <span className="truncate">{children}</span>
    </button>
  )
}

function Stat({ label: lbl, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-tertiary-foreground">{lbl}</span>
      <span className="tabular-nums text-foreground">{value}</span>
    </div>
  )
}

// One device's full dashboard. Remote devices arrive sanitized, so their
// project and session detail is intentionally absent.
/** Honest partiality: a payload from a producer that answers a cold start from
 *  the files the period needs and indexes the rest behind it says so with
 *  `hydration.complete: false`. Absent (every one-shot CLI output, and any
 *  older CLI) means a full parse, so nothing is shown. */
function IndexingNotice({ payload }: { payload?: Payload }) {
  const hydration = payload?.hydration
  if (!hydration || hydration.complete) return null
  return (
    <div role="status" className="mb-3 border-l-2 border-primary px-2.5 py-1 text-[12px] text-muted-foreground">
      Indexing history · {Math.min(hydration.indexedFiles, hydration.totalFiles)}/{hydration.totalFiles} files · totals below cover what is indexed so far
    </div>
  )
}

function DeviceView({ payload, isRemote, unit }: { payload?: Payload; isRemote: boolean; unit: Unit }) {
  const c = payload?.current
  // Cache cards read the period-scoped `current` totals, matching Cost/Calls/
  // Tokens. `history.daily` is the 365-day backfill that feeds the trend chart
  // only; summing it here over-counted the cards for shorter periods (issue 583).
  const cacheWrite = c?.cacheWriteTokens ?? 0
  const cacheRead = c?.cacheReadTokens ?? 0
  const toolBars: BarItem[] = c
    ? Object.entries(c.providers).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ name: k, value: v, display: usd(v) }))
    : []
  const activityBars: BarItem[] = c
    ? c.topActivities.filter((a) => a.cost > 0).map((a) => ({ name: a.name, value: a.cost, display: usd(a.cost) }))
    : []
  // Workflow rides beside Model efficiency only when it carries data. Without
  // it the row is a single full-width Model efficiency panel, so an older peer
  // (no workflow block) renders exactly as the dashboard did before.
  const workflowPanel = c && hasWorkflowContent(c) ? (
    <Panel title="Workflow">
      <WorkflowPanel current={c} />
    </Panel>
  ) : null
  const timeline = payload?.history.timeline

  return (
    <>
      <Card className="mb-3 overflow-hidden">
        <div className="flex items-end justify-between px-5 pt-4">
          <div>
            <div className="text-xs text-tertiary-foreground">
              {c ? `${fmtNum(c.calls)} calls · ${formatSessionCount(c.sessions, c.sessionCountBasis)}` : ' '}
            </div>
            <div className="mt-1 font-display text-4xl tracking-tight tabular-nums text-primary">
              {c ? (unit === 'tokens' ? fmtTokens(c.inputTokens + c.outputTokens) : usd(c.cost)) : <Skeleton className="h-10 w-36" />}
            </div>
          </div>
        </div>
        <div className="mt-3 h-64 px-2 pb-2">
          {!payload ? <Skeleton className="mx-3 mb-3 h-[228px]" /> : (
            <GranularUsageChart daily={payload.history.daily} timeline={payload.history.timeline} unit={unit} />
          )}
        </div>
      </Card>

      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {c ? (
          <>
            <MetricCard label="Cost" value={usd(c.cost)} accent />
            <MetricCard
              label="Tokens"
              value={fmtTokens(c.inputTokens + c.outputTokens)}
              sub={`in ${fmtTokens(c.inputTokens)} / out ${fmtTokens(c.outputTokens)}`}
            />
            <MetricCard label="Calls" value={fmtNum(c.calls)} />
            <MetricCard label="Sessions" value={formatSessionCount(c.sessions, c.sessionCountBasis)} />
            <MetricCard label="Cache hit" value={`${(c.cacheHitPercent || 0).toFixed(1)}%`} />
            <MetricCard label="Cache write" value={fmtTokens(cacheWrite)} />
            <MetricCard label="Cache read" value={fmtTokens(cacheRead)} />
            <MetricCard label="One-shot" value={c.oneShotRate == null ? '—' : `${Math.round(c.oneShotRate * 100)}%`} />
          </>
        ) : (
          Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-20" />)
        )}
      </div>

      <div className="mb-3 grid gap-3 lg:grid-cols-2">
        <Panel title="By tool">
          <BarList items={toolBars} total={c?.cost} />
        </Panel>
        <Panel title="Top models">
          <DataTable
            columns={[
              { key: 'name', label: 'Model' },
              { key: 'cost', label: 'Cost', num: true },
              { key: 'calls', label: 'Calls', num: true },
              { key: 'savings', label: 'Savings', num: true },
            ]}
            rows={(c?.topModels ?? []).filter((m) => m.cost > 0).slice(0, 8).map((m) => ({
              name: m.name,
              cost: usd(m.cost),
              calls: fmtNum(m.calls),
              savings: usd(m.savingsUSD),
            }))}
          />
          {/* $0 rows never make the table (the cost sort buries them), so the
              panel names them instead: usage ran, the figure is unknown, not
              zero. Same "counted at $0" wording every other consumer uses. */}
          {(c?.unpricedModels ?? []).length > 0 && (() => {
            const unpriced = c!.unpricedModels!
            const tokens = unpriced.reduce((s, m) => s + m.tokens, 0)
            const headline = unpriced.length === 1
              ? `1 model counted at $0 · ${fmtTokens(tokens)} tokens — cost unknown, not zero: ${unpriced[0].model}`
              : `${unpriced.length} models counted at $0 · ${fmtTokens(tokens)} tokens — cost unknown, not zero`
            return (
              <div className="mt-3 border-t border-border pt-3 text-xs text-tertiary-foreground">
                {headline}
                <span className="text-tertiary-foreground/80">
                  {' '}(fix with <code>codeburn model-alias</code> / <code>price-override</code>)
                </span>
              </div>
            )
          })()}
        </Panel>
      </div>

      <div className={cn('mb-3 grid gap-3', workflowPanel && 'lg:grid-cols-2')}>
        <Panel title="Model efficiency">
          <DataTable
            columns={[
              { key: 'name', label: 'Model' },
              { key: 'costPerEdit', label: 'Cost/edit', num: true },
              { key: 'oneShot', label: 'One-shot', num: true },
            ]}
            rows={(c?.modelEfficiency ?? []).slice(0, 10).map((m) => ({
              name: m.name,
              costPerEdit: usd(m.costPerEdit),
              // modelEfficiency.oneShotRate arrives as a PERCENT (0-100),
              // unlike current.oneShotRate which is a fraction - the TUI and
              // menubar render it verbatim; multiplying again showed 10000%.
              oneShot: `${Math.round(m.oneShotRate)}%`,
            }))}
          />
        </Panel>
        {workflowPanel}
      </div>

      {timeline && (
        <div className="mb-3">
          <Panel title="Spend punchcard">
            <Punchcard timeline={timeline} />
          </Panel>
        </div>
      )}

      <div className="mb-3 grid gap-3 lg:grid-cols-2">
        <Panel title="Top projects">
          {isRemote ? (
            <p className="py-6 text-center text-sm text-tertiary-foreground">
              Project and session detail stays on that device. Only totals are shared.
            </p>
          ) : (
            <DataTable
              columns={[
                { key: 'name', label: 'Project' },
                { key: 'cost', label: 'Cost', num: true },
                { key: 'sessions', label: 'Sessions', num: true },
                { key: 'avgCost', label: 'Avg/session', num: true },
              ]}
              rows={(c?.topProjects ?? []).slice(0, 10).map((p) => ({
                name: p.name,
                cost: usd(p.cost),
                sessions: formatSessionCount(p.sessions, p.sessionCountBasis),
                avgCost: p.sessionCountBasis === 'identity' && p.avgCostPerSession != null ? usd(p.avgCostPerSession) : '—',
              }))}
            />
          )}
        </Panel>
        <Panel title="By activity">
          <BarList items={activityBars} total={c?.cost} />
        </Panel>
      </div>

      <div className="mb-3 grid gap-3 lg:grid-cols-2">
        <Panel title="Subagents">
          <DataTable
            columns={[
              { key: 'name', label: 'Subagent' },
              { key: 'calls', label: 'Calls', num: true },
              { key: 'cost', label: 'Cost', num: true },
            ]}
            rows={(c?.subagents ?? []).slice(0, 10).map((s) => ({ name: s.name, calls: fmtNum(s.calls), cost: usd(s.cost) }))}
          />
        </Panel>
        <Panel title="Skills">
          <DataTable
            columns={[
              { key: 'name', label: 'Skill' },
              { key: 'turns', label: 'Turns', num: true },
              { key: 'cost', label: 'Cost', num: true },
            ]}
            rows={(c?.skills ?? []).slice(0, 10).map((s) => ({ name: s.name, turns: fmtNum(s.turns), cost: usd(s.cost) }))}
          />
        </Panel>
      </div>

      <div className="mb-3 grid gap-3 lg:grid-cols-2">
        <Panel title="MCP servers">
          <DataTable
            columns={[
              { key: 'name', label: 'Server' },
              { key: 'calls', label: 'Calls', num: true },
            ]}
            rows={(c?.mcpServers ?? []).slice(0, 10).map((m) => ({ name: m.name, calls: fmtNum(m.calls) }))}
          />
        </Panel>
        <Panel title="Savings & waste">
          {c ? (
            <div className="flex flex-col gap-3 py-1">
              <Stat label="Local-model savings" value={usd(c.localModelSavings?.totalUSD)} />
              <Stat
                label={`Retry tax${c.retryTax?.retries ? ` (${fmtNum(c.retryTax.retries)} retries)` : ''}`}
                value={usd(c.retryTax?.totalUSD)}
              />
              <Stat label="Routing waste (potential)" value={usd(c.routingWaste?.totalSavingsUSD)} />
            </div>
          ) : (
            <Skeleton className="h-20" />
          )}
        </Panel>
      </div>

      <Panel title="Tools">
        <DataTable
          columns={[
            { key: 'name', label: 'Tool' },
            { key: 'calls', label: 'Calls', num: true },
          ]}
          rows={(c?.tools ?? []).slice(0, 14).map((t) => ({ name: t.name, calls: fmtNum(t.calls) }))}
        />
      </Panel>
    </>
  )
}

// The "All devices" view: combined totals plus a per-device breakdown. Devices
// are summed for display only; nothing is merged on the server.
// Theme toggle: mirrors the .dark class set by the index.html pre-paint script
// and persists the choice to the same localStorage key.
function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const toggle = () => {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem('codeburn-theme', next ? 'dark' : 'light')
    } catch {
      // storage disabled (some embeds/webviews): persist nothing, OS theme wins next load
    }
  }
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-card text-tertiary-foreground transition-colors hover:bg-interactive-secondary hover:text-foreground max-md:h-9 max-md:w-9 max-md:shrink-0"
    >
      {dark ? (
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 8.53A6 6 0 1 1 7.47 2 4.67 4.67 0 0 0 14 8.53Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <circle cx="8" cy="8" r="3.1" />
          <path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.5 3.5l1.2 1.2M11.3 11.3l1.2 1.2M12.5 3.5l-1.2 1.2M4.7 11.3l-1.2 1.2" />
        </svg>
      )}
    </button>
  )
}

function initialDevice(): string {
  return new URLSearchParams(location.search).get('device') ?? ''
}

function fmtUpdated(iso?: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
}

export function App() {
  const [page, setPage] = useState<'usage' | 'context'>('usage')
  const [period, setPeriod] = useState<Period>('today')
  const [view, setView] = useState<string>(initialDevice)
  const [unit, setUnit] = useState<Unit>('cost')
  // Mobile only: the sidebar collapses to an off-canvas drawer below md.
  // On desktop this flag is inert (the max-md: transform classes don't apply).
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const people = useQuery({ queryKey: ['people'], queryFn: fetchPeople, staleTime: 60_000 })
  const persons = people.data ?? []
  const person = persons.find((p) => p.deviceId === view) ?? persons[0]
  const deviceId = person?.deviceId ?? ''

  const { data, isError, error, isLoading } = useQuery({
    queryKey: ['usage', deviceId, period],
    queryFn: () => fetchDeviceUsage(deviceId, period),
    enabled: deviceId !== '',
  })
  const payload = data?.payload

  // Keep the address shareable: the selected member's device rides in the URL.
  useEffect(() => {
    if (!deviceId) return
    const url = new URL(location.href)
    if (url.searchParams.get('device') === deviceId) return
    url.searchParams.set('device', deviceId)
    history.replaceState(null, '', url)
  }, [deviceId])

  // #1111: the dashboard opens on Today and falls back to 7 days once, when the
  // first payload shows today still has no sessions. Disarmed by the period
  // picker and by switching member, so it never moves a period the viewer chose.
  const autoPeriod = useRef(true)
  useEffect(() => {
    const sessions = payload?.current?.sessions
    if (!autoPeriod.current || sessions === undefined) return
    autoPeriod.current = false
    if (period === 'today' && sessions === 0) setPeriod('week')
  }, [payload, period])

  // Follow the OS theme live while the user has no explicit preference, so
  // flipping the system theme updates the dashboard without a reload.
  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      let saved: string | null = null
      try {
        saved = localStorage.getItem('codeburn-theme')
      } catch {
        // storage disabled: OS theme only
      }
      if (saved !== 'dark' && saved !== 'light') {
        document.documentElement.classList.toggle('dark', mql.matches)
      }
    }
    mql.addEventListener('change', apply)
    return () => mql.removeEventListener('change', apply)
  }, [])

  const viewTitle = person ? `${person.name} · ${person.deviceName}` : people.isLoading ? 'Loading…' : 'Belum ada device'
  const label = payload?.current?.label ?? ''

  return (
    <div className="min-h-screen bg-outer-background p-2.5 max-md:min-h-[100dvh]">
      <div className="flex h-[calc(100vh-20px)] flex-col gap-2.5 max-md:h-[calc(100dvh-20px)]">
        <header className="flex h-12 shrink-0 items-center gap-4 rounded-md border border-border bg-card px-5 shadow-[0_2px_8px_rgba(0,0,0,0.03)] dark:shadow-[0_2px_8px_rgba(0,0,0,0.5)] max-md:h-auto max-md:flex-wrap max-md:gap-3 max-md:px-3 max-md:py-2">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
            aria-expanded={sidebarOpen}
            aria-controls="dashboard-sidebar"
            className="-ml-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-foreground transition-colors hover:bg-interactive-secondary md:hidden"
          >
            <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
            </svg>
          </button>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-lg font-semibold tracking-[-0.02em] text-foreground">
              Mana<span className="text-brand">flow</span>
            </span>
            <span className="ml-1 text-[11px] font-light uppercase tracking-[0.14em] text-tertiary-foreground max-sm:hidden">usage</span>
          </div>

          <div className="ml-6 flex shrink-0 rounded-md border border-border bg-interactive-secondary p-0.5 max-md:ml-2">
            {(['usage', 'context'] as const).map((pg) => (
              <button
                key={pg}
                type="button"
                onClick={() => setPage(pg)}
                className={cn(
                  'rounded-[5px] px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors',
                  page === pg ? 'bg-active-primary text-foreground shadow-sm' : 'text-tertiary-foreground hover:text-foreground',
                )}
              >
                {pg === 'usage' ? 'Usage' : 'Context'}
              </button>
            ))}
          </div>

          {/* All widths: min-w-0 + overflow-x-auto contain mid-width overflow. Below md: full-width second row so ~390px isn't a ~22px clip. */}
          <div className="ml-auto flex min-w-0 items-center gap-2 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-md:ml-0 max-md:w-full max-md:basis-full">
            {page === 'usage' && (
            <>
            <div className="flex shrink-0 rounded-md border border-border bg-interactive-secondary p-0.5">
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => { autoPeriod.current = false; setPeriod(p.key) }}
                  className={cn(
                    'rounded-[5px] px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors max-md:inline-flex max-md:min-h-9 max-md:items-center max-md:justify-center',
                    period === p.key ? 'bg-active-primary text-foreground shadow-sm' : 'text-tertiary-foreground hover:text-foreground',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex shrink-0 rounded-md border border-border bg-interactive-secondary p-0.5">
              {(['cost', 'tokens'] as Unit[]).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setUnit(u)}
                  className={cn(
                    'rounded-[5px] px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors max-md:inline-flex max-md:min-h-9 max-md:items-center max-md:justify-center',
                    unit === u ? 'bg-active-primary text-foreground shadow-sm' : 'text-tertiary-foreground hover:text-foreground',
                  )}
                >
                  {u === 'cost' ? 'Cost' : 'Tokens'}
                </button>
              ))}
            </div>
            </>
            )}
            <ThemeToggle />
          </div>
        </header>

        <div className="flex min-h-0 flex-1 gap-2.5">
          {sidebarOpen && (
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setSidebarOpen(false)}
              className="fixed inset-0 z-30 bg-black/40 md:hidden"
            />
          )}
          <aside
            id="dashboard-sidebar"
            className={cn(
              'flex w-60 shrink-0 flex-col gap-5 overflow-y-auto rounded-md border border-border bg-card p-5',
              'max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:rounded-none max-md:shadow-2xl max-md:transition-[transform,visibility] max-md:duration-200 max-md:ease-out',
              // Closed below md: slide off-canvas AND go visibility:hidden so its
              // links leave the tab order / a11y tree (not just visually hidden).
              sidebarOpen ? 'max-md:visible max-md:translate-x-0' : 'max-md:invisible max-md:-translate-x-full',
            )}
          >
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setSidebarOpen(false)}
              className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-md text-tertiary-foreground transition-colors hover:bg-interactive-secondary hover:text-foreground md:hidden"
            >
              <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
            <div className="flex flex-col gap-1">
              <a
                href="../"
                className="mb-3 rounded-md border border-border px-3 py-2 text-center text-xs font-medium text-foreground transition-colors hover:bg-interactive-secondary max-md:min-h-9"
              >
                ← Ringkasan tim
              </a>
              <p className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-heading">Member</p>
              {persons.map((p) => (
                <SideLink
                  key={p.deviceId}
                  active={p.deviceId === deviceId}
                  onClick={() => { autoPeriod.current = false; setView(p.deviceId); setSidebarOpen(false) }}
                >
                  <span className="block truncate">{p.name}</span>
                  <span className="block truncate text-[11px] text-tertiary-foreground">{p.deviceName}</span>
                </SideLink>
              ))}
              {people.isLoading && <p className="px-2.5 py-1 text-xs text-tertiary-foreground">Loading…</p>}
              {people.isSuccess && persons.length === 0 && (
                <p className="px-2.5 py-1 text-xs text-tertiary-foreground">Belum ada member yang mengirim data.</p>
              )}
            </div>

            <div className="mt-auto border-t border-border pt-4">
              <p className="text-[11px] leading-relaxed text-tertiary-foreground">
                Data dikirim dari laptop member tiap 30 menit.
                {data?.updatedAt ? ` Terakhir diperbarui ${fmtUpdated(data.updatedAt)}.` : ''}
              </p>
            </div>
          </aside>

          <main className="min-w-0 flex-1 overflow-y-auto pr-0.5">
            <div className="mb-3 flex items-baseline justify-between">
              <h1 className="font-display text-xl tracking-tight text-foreground">{page === 'context' ? `Context · ${viewTitle}` : viewTitle}</h1>
              <span className="text-xs text-tertiary-foreground">{page === 'usage' ? label : ''}</span>
            </div>

            {page === 'usage' && <IndexingNotice payload={payload} />}

            {page === 'context' ? (
              <ContextExplorer deviceId={deviceId} />
            ) : data === null ? (
              <div className="text-sm text-tertiary-foreground">Belum ada data Usage untuk periode ini dari device ini.</div>
            ) : (
              <DeviceView payload={isLoading ? undefined : payload} isRemote={false} unit={unit} />
            )}

            {page === 'usage' && (isError || people.isError) && (
              <div className="mt-4 text-sm text-tertiary-foreground">Failed to load: {String(((error ?? people.error) as Error)?.message)}</div>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}
