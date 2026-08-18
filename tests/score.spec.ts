import { describe, expect, it } from 'vitest'
import { scorePackage, scoreBatch, gradeOf, renderScore, renderLeaderboard, extractRegistryNames, type ScoreResult } from '../src/score.js'

function mkInfo(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'test-pkg',
    'dist-tags': { latest: '1.0.0', next: '1.0.0' },
    versions: {
      '1.0.0': {
        name: 'test-pkg',
        version: '1.0.0',
        description: 'A test plugin.',
        license: 'MIT',
        peerDependencies: { '@deepseek-ai/dsh-tools': '^0.1.0-rc.6' },
      },
    },
    time: { '1.0.0': '2026-08-01T00:00:00Z' },
    ...overrides,
  }
}

const dshToolsOk = {
  name: '@deepseek-ai/dsh-tools',
  'dist-tags': { latest: '0.1.0-rc.7', next: '0.1.0-rc.7' },
  versions: { '0.1.0-rc.7': { name: '@deepseek-ai/dsh-tools', version: '0.1.0-rc.7' } },
  time: { '0.1.0-rc.7': '2026-08-01T00:00:00Z' },
}

const dshToolsBroken = {
  name: '@deepseek-ai/dsh-tools',
  'dist-tags': { latest: '0.0.1-rc.1', next: '0.1.0-rc.7' },
  versions: {
    '0.0.1-rc.1': { name: '@deepseek-ai/dsh-tools', version: '0.0.1-rc.1' },
    '0.1.0-rc.7': { name: '@deepseek-ai/dsh-tools', version: '0.1.0-rc.7' },
  },
  time: { '0.0.1-rc.1': '2026-08-01T00:00:00Z', '0.1.0-rc.7': '2026-08-01T00:00:00Z' },
}

const goodPeer = {
  name: 'good-peer',
  'dist-tags': { latest: '1.2.0' },
  versions: { '1.2.0': { name: 'good-peer', version: '1.2.0' } },
}

function makeFetch(map: Record<string, Record<string, unknown> | null>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    const name = decodeURIComponent(url.split('/').pop() ?? '')
    const entry = map[name]
    if (entry === undefined || entry === null) {
      return { status: 404, ok: false, json: async () => ({}) } as unknown as Response
    }
    return { status: 200, ok: true, json: async () => entry } as unknown as Response
  }) as typeof fetch
}

const now = () => Date.parse('2026-08-18T00:00:00Z')

describe('gradeOf', () => {
  it('maps scores to grades', () => {
    expect(gradeOf(95)).toBe('A')
    expect(gradeOf(80)).toBe('B')
    expect(gradeOf(65)).toBe('C')
    expect(gradeOf(50)).toBe('D')
    expect(gradeOf(20)).toBe('F')
  })
})

describe('scorePackage', () => {
  it('scores a healthy package near the top', async () => {
    const map = {
      'test-pkg': mkInfo(),
      '@deepseek-ai/dsh-tools': dshToolsOk,
    }
    const result = await scorePackage('test-pkg', { fetchImpl: makeFetch(map), now })
    expect(result.schema).toBe('dsh-quality-score/v1')
    expect(result.ok).toBe(true)
    expect(result.error).toBe('')
    expect(result.score).toBeGreaterThanOrEqual(95)
    expect(result.grade).toBe('A')
    const manifest = result.components.find((c) => c.id === 'manifest')
    expect(manifest?.earned).toBe(30)
  })

  it('penalizes broken dsh-tools latest and dead peer ranges (#2763)', async () => {
    const map = {
      'test-pkg': mkInfo({
        versions: {
          '1.0.0': {
            name: 'test-pkg',
            version: '1.0.0',
            description: 'A test plugin.',
            license: 'MIT',
            peerDependencies: {
              '@deepseek-ai/dsh-tools': '^0.1.0-rc.6',
              'dead-peer': '^9.9.9',
            },
          },
        },
      }),
      '@deepseek-ai/dsh-tools': dshToolsBroken,
      'dead-peer': null,
    }
    const result = await scorePackage('test-pkg', { fetchImpl: makeFetch(map), now })
    expect(result.score).toBeLessThan(80)
    expect(result.issues.some((i) => i.includes('#2763'))).toBe(true)
    expect(result.issues.some((i) => i.includes('dead-peer'))).toBe(true)
    expect(result.grade).toMatch(/[BCDEF]/)
  })

  it('penalizes latest!=next', async () => {
    const map = {
      'test-pkg': mkInfo({ 'dist-tags': { latest: '0.0.1-rc.1', next: '0.1.0-rc.7' } }),
      '@deepseek-ai/dsh-tools': dshToolsOk,
    }
    const result = await scorePackage('test-pkg', { fetchImpl: makeFetch(map), now })
    const distTag = result.components.find((c) => c.id === 'dist-tag')
    expect(distTag?.earned).toBe(0)
    expect(result.issues.some((i) => i.includes('dist-tag'))).toBe(true)
  })

  it('penalizes staleness', async () => {
    const map = {
      'test-pkg': mkInfo({ time: { '1.0.0': '2020-01-01T00:00:00Z' } }),
      '@deepseek-ai/dsh-tools': dshToolsOk,
    }
    const result = await scorePackage('test-pkg', { fetchImpl: makeFetch(map), now })
    const freshness = result.components.find((c) => c.id === 'freshness')
    expect(freshness?.earned).toBe(0)
  })

  it('returns an error envelope for missing packages', async () => {
    const result = await scorePackage('missing-pkg', { fetchImpl: makeFetch({}), now })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('package not found')
    expect(result.score).toBe(0)
  })
})

describe('graceful offline', () => {
  it('returns an error envelope when the registry is unreachable', async () => {
    const brokenFetch = (async () => { throw new Error('network down') }) as unknown as typeof fetch
    const result = await scorePackage('any-pkg', { fetchImpl: brokenFetch, now })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('registry unreachable')
    expect(result.score).toBe(0)
  })
})

describe('manifest reads description/license from full metadata (regression: corgi omits them)', () => {
  it('awards manifest points when the full doc has description and license', async () => {
    const map = {
      'test-pkg': mkInfo(),
      '@deepseek-ai/dsh-tools': dshToolsOk,
    }
    const result = await scorePackage('test-pkg', { fetchImpl: makeFetch(map), now })
    const manifest = result.components.find((c) => c.id === 'manifest')
    expect(manifest?.earned).toBe(30)
    expect(result.issues.some((i) => i.includes('description'))).toBe(false)
    expect(result.issues.some((i) => i.includes('license'))).toBe(false)
  })
})

describe('scoreBatch / renderLeaderboard', () => {
  it('scores multiple packages sharing the cache and ranks them', async () => {
    const map = {
      'good-pkg': mkInfo({ name: 'good-pkg' }),
      'bad-pkg': mkInfo({
        name: 'bad-pkg',
        'dist-tags': { latest: '0.0.1-rc.1', next: '0.1.0-rc.7' },
        versions: {
          '0.0.1-rc.1': { name: 'bad-pkg', version: '0.0.1-rc.1', description: 'x', license: 'MIT', peerDependencies: { '@deepseek-ai/dsh-tools': '^0.1.0-rc.6' } },
        },
        time: { '0.0.1-rc.1': '2026-08-01T00:00:00Z' },
      }),
      '@deepseek-ai/dsh-tools': dshToolsBroken,
    }
    const results = await scoreBatch(['good-pkg', 'bad-pkg'], { fetchImpl: makeFetch(map), now })
    expect(results).toHaveLength(2)
    expect(results[0]?.score).toBeGreaterThan(results[1]?.score)
    const text = renderLeaderboard(results).join('\n')
    expect(text).toContain('| 1 | good-pkg |')
    expect(text).toContain('| 2 | bad-pkg |')
  })
})

describe('extractRegistryNames', () => {
  it('extracts unique npm-installable names and ignores git targets', () => {
    const reg = {
      plugins: [
        { install: { target: 'npm', spec: 'dsh-a' } },
        { install: { target: 'npm', spec: 'dsh-a' } },
        { install: { target: 'npm', spec: '@scope/dsh-b' } },
        { install: { target: 'git', spec: 'github:x/y' } },
        { install: { target: 'npm', spec: '' } },
        {},
      ],
    }
    expect(extractRegistryNames(reg)).toEqual(['dsh-a', '@scope/dsh-b'])
  })
})

describe('renderScore', () => {
  it('renders the summary line and components', async () => {
    const map = { 'test-pkg': mkInfo(), '@deepseek-ai/dsh-tools': dshToolsOk }
    const result: ScoreResult = await scorePackage('test-pkg', { fetchImpl: makeFetch(map), now })
    const text = renderScore(result).join('\n')
    expect(text).toContain('dsh-quality-score — test-pkg:')
    expect(text).toContain('/30]')
  })
})