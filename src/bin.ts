/** bin entry for dsh-quality-score. */

import { main } from './cli.js'

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code
})