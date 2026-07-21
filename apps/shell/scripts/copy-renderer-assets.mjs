/**
 * Copies the renderer's static assets into dist.
 *
 * `tsc` emits JavaScript and nothing else, so index.html and style.css would be
 * missing from a build that otherwise looks complete — the window would open
 * blank with no error, since a failed file load is not an exception.
 *
 * A named list rather than a directory sweep: the renderer must never ship a
 * file nobody chose to ship, and this is the same reasoning that keeps
 * `git add -A` blocked in this repository.
 */
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const FROM = join(HERE, '..', 'src', 'renderer')
const TO = join(HERE, '..', 'dist', 'renderer')

const ASSETS = ['index.html', 'style.css']

mkdirSync(TO, { recursive: true })
for (const asset of ASSETS) {
  copyFileSync(join(FROM, asset), join(TO, asset))
}
console.log(`copied ${ASSETS.length} renderer assets to dist/renderer`)
