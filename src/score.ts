/**
 * Quality scorecard core for dsh-quality-score.
 *
 * Scores a DeepSeek Harness plugin package on npm (0-100) across six
 * components: manifest completeness, peer resolvability, dist-tag health,
 * dead ranges, freshness, and dsh-tools peer compatibility. Read-only,
 * zero runtime dependencies; the fetch is injectable for tests.
 * @module dsh-quality-score/score
 */

import { satisfies, maxSatisfying, isRegistryRange } from './version.js'

export type ScoreComponent = {
  id: string
  name: string
  max: number
  earned: number
  note: string
}

export type ScoreResult = {
  schema: 'dsh-quality-score/v1'
  name: string
  ok: boolean
  score: number
  grade: string
  components: ScoreComponent[]
  issues: string[]
  suggestions: string[]
  error: string
}

const GRADES: Array<[number, string]> = [
  [90, 'A'],
  [75, 'B'],
  [60, 'C'],
  [45, 'D'],
  [0, 'F'],
]

export function gradeOf(score: number): string {
  for (const [min, grade] of GRADES) {
    if (score >= min) return grade
  }
  return 'F'
}

type Meta = {
  name?: unknown
  version?: unknown
  description?: unknown
  license?: unknown
  keywords?: unknown
  dependencies?: Record<string, unknown>
  peerDependencies?: Record<string, unknown>
}

type RegistryInfo = {
  name?: unknown
  'dist-tags'?: Record<string, string>
  versions?: Record<string, Meta>
  time?: Record<string, string>
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

function encodeName(name: string): string {
  return name.startsWith('@') ? name.replace('/', '%2F') : name
}

export async function fetchRegistryInfo(name: string, fetchImpl: typeof fetch, timeoutMs = 15000, accept = 'application/vnd.npm.install-v1+json'): Promise<RegistryInfo | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(`https://registry.npmjs.org/${encodeName(name)}`, {
      headers: { accept },
      signal: controller.signal,
    })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`registry responded ${res.status} for ${name}`)
    return await res.json() as RegistryInfo
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Full metadata doc for the scored package itself. The abbreviated (corgi)
 * doc omits `description` / `license` per version, which would mis-score the
 * manifest component; the full doc has them. Dependency lookups stay on the
 * abbreviated doc (only version lists matter there).
 */
export async function fetchFullRegistryInfo(name: string, fetchImpl: typeof fetch, timeoutMs = 30000): Promise<RegistryInfo | null> {
  return fetchRegistryInfo(name, fetchImpl, timeoutMs, 'application/json')
}

function declaredRanges(meta: Meta | undefined): Array<{ name: string; range: string; source: 'dep' | 'peer' }> {
  const out: Array<{ name: string; range: string; source: 'dep' | 'peer' }> = []
  for (const [source, table] of [['dep', meta?.dependencies], ['peer', meta?.peerDependencies]] as const) {
    if (table && typeof table === 'object') {
      for (const [name, range] of Object.entries(table)) {
        if (typeof range === 'string' && isRegistryRange(range)) out.push({ name, range, source })
      }
    }
  }
  return out
}

/**
 * Score `name` against the npm registry.
 * `deps` is a cache for dependency metadata lookups (keyed by package name).
 */
export async function scorePackage(
  name: string,
  deps: { fetchImpl?: typeof fetch; cache?: Map<string, RegistryInfo | null>; now?: () => number } = {},
): Promise<ScoreResult> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const cache = deps.cache ?? new Map<string, RegistryInfo | null>()
  const now = deps.now ?? Date.now
  const issues: string[] = []
  const suggestions: string[] = []
  const components: ScoreComponent[] = []

  let info: RegistryInfo | null
  try {
    info = await fetchFullRegistryInfo(name, fetchImpl)
  } catch (error) {
    return {
      schema: 'dsh-quality-score/v1',
      name,
      ok: false,
      score: 0,
      grade: 'F',
      components: [],
      issues: [`registry unreachable: ${String(error instanceof Error ? error.message : error)}`],
      suggestions: [],
      error: `registry unreachable: ${String(error instanceof Error ? error.message : error)}`,
    }
  }
  if (info === null) {
    return {
      schema: 'dsh-quality-score/v1',
      name,
      ok: false,
      score: 0,
      grade: 'F',
      components: [],
      issues: [`package ${name} does not exist on the registry`],
      suggestions: [],
      error: 'package not found',
    }
  }
  if (typeof info.name !== 'string' || info['dist-tags'] === undefined) {
    return {
      schema: 'dsh-quality-score/v1',
      name,
      ok: false,
      score: 0,
      grade: 'F',
      components: [],
      issues: ['registry metadata is missing name or dist-tags'],
      suggestions: [],
      error: 'invalid registry metadata',
    }
  }

  const latest = info['dist-tags'].latest ?? null
  const next = info['dist-tags'].next ?? null
  const latestMeta = latest !== null ? info.versions?.[latest] : undefined
  const latestTime = latest !== null ? info.time?.[latest] : undefined

  // 1. Manifest completeness (max 30)
  {
    const earned = (asString(latestMeta?.name) !== null ? 7 : 0)
      + (asString(latestMeta?.version) !== null ? 7 : 0)
      + (asString(latestMeta?.description) !== null ? 8 : 0)
      + (asString(latestMeta?.license) !== null ? 8 : 0)
    if (asString(latestMeta?.description) === null) issues.push('latest version has no description')
    if (asString(latestMeta?.license) === null) issues.push('latest version has no license')
    components.push({
      id: 'manifest',
      name: 'Manifest completeness',
      max: 30,
      earned,
      note: latest !== null ? `version ${latest}` : 'no latest version',
    })
  }

  // 2. Peer resolvability (max 20)
  {
    const ranges = declaredRanges(latestMeta).filter((r) => r.source === 'peer')
    let earned = 20
    const problems: string[] = []
    for (const r of ranges) {
      let depInfo = cache.get(r.name)
      if (depInfo === undefined) {
        try {
          depInfo = await fetchRegistryInfo(r.name, fetchImpl)
        } catch {
          depInfo = null
        }
        cache.set(r.name, depInfo)
      }
      const versions = Object.keys(depInfo?.versions ?? {})
      if (versions.length === 0) {
        problems.push(`${r.name}@${r.range} (package not found)`)
        earned -= Math.max(2, Math.floor(20 / Math.max(ranges.length, 1)))
      } else if (maxSatisfying(versions, r.range) === null) {
        problems.push(`${r.name}@${r.range} (no published match)`)
        earned -= Math.max(2, Math.floor(20 / Math.max(ranges.length, 1)))
      }
    }
    earned = Math.max(0, earned)
    if (problems.length > 0) {
      issues.push(`peer ranges unresolved: ${problems.join(', ')}`)
      suggestions.push('Fix peer ranges to versions that exist on the registry')
    }
    components.push({
      id: 'peer-resolvable',
      name: 'Peer resolvability',
      max: 20,
      earned,
      note: ranges.length === 0 ? 'no peer dependencies' : `${ranges.length} peer range(s)`,
    })
  }

  // 3. Dist-tag health (max 15)
  {
    let earned = 15
    const note = latest !== null && next !== null && latest !== next ? `latest=${latest}, next=${next}` : `latest=${latest ?? 'none'}`
    if (latest !== null && next !== null && latest !== next) {
      earned -= 15
      issues.push(`dist-tag latest (${latest}) differs from next (${next}) — default installs may resolve the wrong line`)
      suggestions.push('Publish with the same version under latest, or fix the dist-tag')
    }
    components.push({ id: 'dist-tag', name: 'Dist-tag health', max: 15, earned, note })
  }

  // 4. Dead ranges (max 15)
  {
    const ranges = declaredRanges(latestMeta)
    let dead = 0
    for (const r of ranges) {
      if (r.source !== 'peer') continue // peers already counted in component 2
      let depInfo = cache.get(r.name)
      if (depInfo === undefined) {
        try {
          depInfo = await fetchRegistryInfo(r.name, fetchImpl)
        } catch {
          depInfo = null
        }
        cache.set(r.name, depInfo)
      }
      const versions = Object.keys(depInfo?.versions ?? {})
      if (versions.length === 0 || maxSatisfying(versions, r.range) === null) dead += 1
    }
    const earned = dead === 0 ? 15 : Math.max(0, 15 - dead * 5)
    if (dead > 0) {
      issues.push(`${dead} dead peer range(s) in the latest version`)
      suggestions.push('Remove or fix ranges that reference unpublished package names')
    }
    components.push({ id: 'dead-ranges', name: 'Dead ranges', max: 15, earned, note: dead === 0 ? 'none' : `${dead} dead` })
  }

  // 5. Freshness (max 10)
  {
    let earned = 10
    if (latestTime !== undefined) {
      const ageDays = (now() - Date.parse(latestTime)) / 86_400_000
      if (ageDays > 365) {
        earned = 0
        issues.push(`latest release is ${Math.floor(ageDays)} days old`)
        suggestions.push('Release a maintenance update, or document the project as unmaintained')
      } else if (ageDays > 180) {
        earned = 5
        issues.push(`latest release is ${Math.floor(ageDays)} days old`)
      }
    }
    components.push({ id: 'freshness', name: 'Freshness', max: 10, earned, note: latestTime !== undefined ? latestTime.slice(0, 10) : 'unknown' })
  }

  // 6. dsh-tools peer compatibility (max 10)
  {
    const ranges = declaredRanges(latestMeta).filter((r) => r.name === '@deepseek-ai/dsh-tools')
    let earned = 10
    let note = 'no dsh-tools peer'
    if (ranges.length > 0) {
      let dshTools = cache.get('@deepseek-ai/dsh-tools')
      if (dshTools === undefined) {
        try {
          dshTools = await fetchRegistryInfo('@deepseek-ai/dsh-tools', fetchImpl)
        } catch {
          dshTools = null
        }
        cache.set('@deepseek-ai/dsh-tools', dshTools)
      }
      const dshToolsLatest = dshTools?.['dist-tags']?.latest ?? null
      note = `declared ${ranges.map((r) => r.range).join(', ')}; dsh-tools latest=${dshToolsLatest ?? 'unknown'}`
      const incompatible = ranges.some((r) => dshToolsLatest !== null && !satisfies(dshToolsLatest, r.range))
      if (incompatible) {
        earned = 0
        issues.push('declared @deepseek-ai/dsh-tools peer range is contradicted by the broken latest dist-tag (#2763 class)')
        suggestions.push('Install with @deepseek-ai/dsh-tools@0.1.0-rc.7 (or the matching rc) until the official latest is fixed')
      }
    }
    components.push({ id: 'dsh-tools-peer', name: 'dsh-tools peer compat', max: 10, earned, note })
  }

  const score = components.reduce((sum, c) => sum + c.earned, 0)
  return {
    schema: 'dsh-quality-score/v1',
    name,
    ok: issues.length === 0,
    score,
    grade: gradeOf(score),
    components,
    issues,
    suggestions,
    error: '',
  }
}

export type RegistryLike = {
  plugins?: Array<{ install?: { target?: unknown; spec?: unknown } }>
}

/** Extract unique npm-installable package names from a dsh-subscribe registry. */
export function extractRegistryNames(reg: RegistryLike): string[] {
  const raw: string[] = []
  for (const p of reg.plugins ?? []) {
    if (p?.install?.target === 'npm' && typeof p.install.spec === 'string' && p.install.spec !== '') {
      raw.push(p.install.spec)
    }
  }
  return [...new Set(raw)]
}

export type ScoreDeps = {
  fetchImpl?: typeof fetch
  cache?: Map<string, RegistryInfo | null>
  now?: () => number
}

/**
 * Score many packages in sequence sharing one metadata cache. Order is
 * preserved; use renderLeaderboard for the ranked view.
 */
export async function scoreBatch(names: string[], deps: ScoreDeps = {}): Promise<ScoreResult[]> {
  const shared: ScoreDeps = { fetchImpl: deps.fetchImpl, cache: deps.cache, now: deps.now }
  const out: ScoreResult[] = []
  for (const name of names) {
    out.push(await scorePackage(name, shared))
  }
  return out
}

/** Render a ranked leaderboard (score desc) as plain text. */
export function renderLeaderboard(results: ScoreResult[]): string[] {
  const sorted = [...results].sort((a, b) => b.score - a.score)
  const lines: string[] = []
  lines.push('dsh-quality-score leaderboard — top scores first')
  lines.push('| Rank | Package | Score | Grade | Key issue |')
  lines.push('|---|---|---|---|---|')
  sorted.forEach((r, i) => {
    const key = r.issues[0] ?? (r.ok ? 'ok' : r.error)
    lines.push(`| ${i + 1} | ${r.name} | ${r.score}/100 | ${r.grade} | ${key} |`)
  })
  return lines
}

/** Render a score result as plain text. */
export function renderScore(result: ScoreResult): string[] {
  const lines: string[] = []
  lines.push(`dsh-quality-score — ${result.name}: ${result.score}/100 (${result.grade})`)
  if (result.error !== '') {
    lines.push(`~ ${result.error}`)
    return lines
  }
  for (const c of result.components) {
    lines.push(`[${c.earned}/${c.max}] ${c.name}: ${c.note}`)
  }
  for (const issue of result.issues) lines.push(`! ${issue}`)
  for (const s of result.suggestions) lines.push(`→ ${s}`)
  return lines
}