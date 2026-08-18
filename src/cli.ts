/**
 * CLI entry for dsh-quality-score.
 *   dsh-quality-score <npm-name> [--json]
 * Exit: 0 scored (even with issues), 2 usage/IO error.
 */

import { readFileSync } from 'node:fs'
import { scorePackage, scoreBatch, renderScore, renderLeaderboard, extractRegistryNames } from './score.js'

function usage(): string {
  return [
    'dsh-quality-score — quality scorecard for DeepSeek Harness plugins',
    '',
    'Usage:',
    '  dsh-quality-score <npm-name> [--json]',
    '  dsh-quality-score --batch <names-file> [--json]',
    '  dsh-quality-score --batch-registry <registry.json> [--category <name>] [--json]',
    '',
    'Options:',
    '  --json            print the machine-readable dsh-quality-score/v1 report(s)',
    '  --batch <file>    score every package name in the file (one per line) and print a leaderboard',
    '  --help            show this help',
    '',
    'Examples:',
    '  dsh-quality-score dsh-dep-audit --json',
    '  dsh-quality-score --batch registry-names.txt',
  ].join('\n')
}

export async function main(argv: string[]): Promise<number> {
  let name: string | null = null
  let batch: string | null = null
  let batchRegistry: string | null = null
  let category: string | null = null
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') { process.stdout.write(usage() + '\n'); return 0 }
    if (arg === '--json') { json = true; continue }
    if (arg === '--batch') {
      batch = argv[++i] ?? ''
      if (batch === '') {
        process.stderr.write(`dsh-quality-score: --batch requires a file path\n\n${usage()}\n`)
        return 2
      }
      continue
    }
    if (arg === '--category') {
      category = argv[++i] ?? ''
      if (category === '') {
        process.stderr.write(`dsh-quality-score: --category requires a name\n\n${usage()}\n`)
        return 2
      }
      continue
    }
    if (arg === '--batch-registry') {
      batchRegistry = argv[++i] ?? ''
      if (batchRegistry === '') {
        process.stderr.write(`dsh-quality-score: --batch-registry requires a registry.json path\n\n${usage()}\n`)
        return 2
      }
      continue
    }
    if (arg.startsWith('-')) {
      process.stderr.write(`dsh-quality-score: unknown option ${arg}\n\n${usage()}\n`)
      return 2
    }
    if (name !== null) {
      process.stderr.write(`dsh-quality-score: expected exactly one package name\n\n${usage()}\n`)
      return 2
    }
    name = arg
  }
  try {
    if (batchRegistry !== null) {
      const reg = JSON.parse(readFileSync(batchRegistry, 'utf8'))
      const plugins = Array.isArray(reg?.plugins) ? reg.plugins : []
      const names = extractRegistryNames(reg, category ?? undefined)
      const results = await scoreBatch(names)
      if (json) {
        process.stdout.write(JSON.stringify(results, null, 2) + '\n')
      } else {
        process.stdout.write(renderLeaderboard(results).join('\n') + '\n')
      }
      return 0
    }
    if (batch !== null) {
      const names = readFileSync(batch, 'utf8')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l !== '' && !l.startsWith('#'))
      const results = await scoreBatch(names)
      if (json) {
        process.stdout.write(JSON.stringify(results, null, 2) + '\n')
      } else {
        process.stdout.write(renderLeaderboard(results).join('\n') + '\n')
      }
      return 0
    }
    if (name === null) {
      process.stderr.write(`dsh-quality-score: missing package name\n\n${usage()}\n`)
      return 2
    }
    const result = await scorePackage(name)
    if (json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    } else {
      process.stdout.write(renderScore(result).join('\n') + '\n')
    }
    return 0
  } catch (error) {
    process.stderr.write(`dsh-quality-score: ${String(error instanceof Error ? error.message : error)}\n`)
    return 2
  }
}