/**
 * dsh-quality-score — quality scorecard for DeepSeek Harness plugins.
 * @module dsh-quality-score
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createRequire } from 'node:module'
import { satisfiesCaret } from './version.js'
import { scorePackage, renderScore, type ScoreResult } from './score.js'

export const name = 'dsh-quality-score'

export const inject = ['tools']

export const TESTED_PEER_RANGE = '^0.1.0-rc.6'

const require = createRequire(import.meta.url)

export function resolvedDshToolsVersion(): string {
  try {
    const pkg = require('@deepseek-ai/dsh-tools/package.json') as { version?: string }
    return pkg.version ?? 'unknown'
  } catch {
    return 'unresolved'
  }
}

export function assertPeerCompatible(): void {
  const version = resolvedDshToolsVersion()
  if (!satisfiesCaret(version, TESTED_PEER_RANGE)) {
    throw new Error(
      `dsh-quality-score: resolved @deepseek-ai/dsh-tools ${version}, but this plugin is tested with `
      + `${TESTED_PEER_RANGE}. Upgrade DeepSeek Harness to 0.1.0-rc.6 or later, then reinstall this plugin.`,
    )
  }
}

export interface Config {
  defaultRegistry?: string
}

export const Config: Schema<Config> = Schema.object({
  defaultRegistry: Schema.string().default('https://registry.npmjs.org'),
})

export function apply(ctx: Context, config: Config): void {
  assertPeerCompatible()
  ctx.tools.register(defineTool({
    name: 'quality_score',
    description:
      'Score a DeepSeek Harness plugin package on npm from 0 to 100 with a grade and per-component '
      + 'breakdown: manifest completeness, peer resolvability, dist-tag health, dead ranges, freshness, '
      + 'and dsh-tools peer compatibility. Returns a dsh-quality-score/v1 report with issues and fix '
      + 'suggestions. Read-only.',
    parameters: {
      name: { type: 'string', required: true, description: 'npm package name of the plugin (e.g. dsh-dep-audit)' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          schema: { type: 'string' },
          name: { type: 'string' },
          ok: { type: 'boolean' },
          score: { type: 'number' },
          grade: { type: 'string' },
          components: { type: 'array' },
          issues: { type: 'array' },
          suggestions: { type: 'array' },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => renderScore(value as unknown as ScoreResult).map((text) => ({ type: 'text' as const, text })),
    },
    async execute(args, _exec): Promise<ScoreResult> {
      return scorePackage(args.name)
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `Quality score: ${args.name}`,
      kind: 'other',
      rawInput: args,
    }),
  }))
}