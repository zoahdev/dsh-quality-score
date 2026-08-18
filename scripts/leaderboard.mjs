#!/usr/bin/env node
/**
 * Render a quality leaderboard from dsh-quality-score JSON output.
 *
 * Usage:
 *   dsh-quality-score --batch names.txt --json > scores.json
 *   node scripts/leaderboard.mjs scores.json > leaderboard.md
 *
 * Accepts either an array of dsh-quality-score/v1 results (--batch --json)
 * or a single result object.
 */

import { readFileSync } from 'node:fs'
import { renderLeaderboard } from '../lib/score.js'

const file = process.argv[2]
if (file === undefined) {
  console.error('usage: node scripts/leaderboard.mjs <scores.json>')
  process.exit(2)
}

let data = JSON.parse(readFileSync(file, 'utf8'))
const results = Array.isArray(data) ? data : [data]
process.stdout.write(renderLeaderboard(results).join('\n') + '\n')