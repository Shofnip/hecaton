/**
 * Fetches the Chromium build this app ships.
 *
 * The binary is **not committed** — 440 MB of third-party build output has no
 * business in git history — so it is fetched here instead, from a pinned
 * revision, verified against a pinned SHA256 before a single byte of it is
 * unpacked. That verification is the whole point of the script: the download is
 * an unsigned zip over HTTPS from a bucket, and the hash is what turns it into
 * the same artefact probe P5 measured rather than whatever the bucket serves
 * today. See docs/adr/0016-ship-our-own-chromium.md.
 *
 * Run it after `npm install` (which wipes `node_modules`, and with it the link
 * this script leaves under Electron's resources directory), and in the release
 * workflow before packaging. It is idempotent and cheap on a second run: the
 * unpacked tree under `vendor/` survives `npm install`, so the usual case is
 * only relinking.
 *
 * Windows-only, like everything that launches a browser here. It shells out to
 * PowerShell for the unzip because .NET's ZipFile does 440 MB in a few seconds
 * where Expand-Archive takes minutes.
 */
import { createHash } from 'node:crypto'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// ---------------------------------------------------------------------------
// The pin. Raising it is a release ritual, not a routine bump - docs/releasing.md
// step 1 carries it, and tests/bundled-browser.test.ts holds this file and that
// document to the same revision so the ritual cannot silently describe an old one.
//
// The source is the chromium-browser-snapshots bucket, which is **trunk**: at the
// time this was pinned it sat some 14,000 commits ahead of the stable channel and
// receives no stable-branch security backports. That was the owner's decision, and
// what it costs is written down in ADR-0016 rather than discovered later.
// ---------------------------------------------------------------------------
const REVISION = '1682878'
const SHA256 = 'ca3ee2bc84c81de987d7a9091e0bfe5024d905838c06429a4f3732e9d9d5e4a2'
const VERSION = '154.0.8014.0'
const URL = `https://storage.googleapis.com/chromium-browser-snapshots/Win_x64/${REVISION}/chrome-win.zip`

/**
 * What the snapshot ships that this app does not.
 *
 * An allowlist would be better and is not practical for 261 files of somebody
 * else's build, so this is the deliberate opposite: a named list of what is
 * dropped, each entry with a reason, in the same spirit as the `files` allowlist
 * in electron-builder.yml. Measured 2026-08-20: removing these takes the tree
 * from 798 MB / 261 files to 440 MB / 254 files, and the browser still launches,
 * is found by the WMI filter, keeps ADR-0011's window geometry to the pixel,
 * spawns its renderer, GPU and `utility:audio.mojom.AudioService` children, and
 * exits `Normal`.
 *
 * The stripping happens here rather than in electron-builder's `filter`, so the
 * browser a developer runs is byte-identical to the one that ships. A filter
 * would have made those two differ, which is the class of bug this repository
 * keeps finding.
 *
 * **Re-measure after raising the revision.** A future snapshot could move
 * something load-bearing into one of these.
 */
const NOT_SHIPPED = [
  // 358 MB of it, and the single largest file in the snapshot: Chromium's own
  // interactive UI test binary. Nothing invokes it; it is here because the
  // bucket packages the test build.
  'interactive_ui_tests.exe',
  // Chrome's installer and updater. This app is portable and pins its browser;
  // an installer inside it can only do the wrong thing.
  'setup.exe',
  // Services designed to be registered and run elevated. Nothing in Hecaton asks
  // for elevation, and shipping the binaries of two that can is surface with no
  // corresponding use. Consequence worth knowing: without elevation_service.exe
  // the bundled browser can never write App-Bound-Encryption (v20) cookies -
  // which is what would bind a profile to one executable. Here that is the
  // property we want, not a loss (probe P5 measured the existing profiles at
  // v10, and v20 is what would have stopped them carrying over).
  'elevated_tracing_service.exe',
  'elevation_service.exe',
  // Windows toast notifications, PWA shortcut launching, and the shortcut-identity
  // proxy. All three serve a browser someone installed and pinned to a taskbar.
  // The windows here are reparented into the panel and have no shortcuts.
  'notification_helper.exe',
  'chrome_pwa_launcher.exe',
  'chrome_proxy.exe',
]

const VENDOR = join(ROOT, 'vendor', 'chromium')
const TREE = join(VENDOR, 'chrome-win')
const STAMP = join(VENDOR, 'pinned.json')
const ZIP = join(VENDOR, `chrome-win-${REVISION}.zip`)

// Where Electron looks at runtime. `bundledBrowserPath` joins
// `process.resourcesPath` with `chromium/chrome-win/chrome.exe`, and in
// development that root is node_modules/electron/dist/resources - measured
// 2026-08-20, along with the fact that a junction under it resolves for
// existsSync and spawn without any elevation.
const ELECTRON_RESOURCES = join(ROOT, 'node_modules', 'electron', 'dist', 'resources')
const LINK = join(ELECTRON_RESOURCES, 'chromium')

const log = (message) => console.log(`fetch-chromium: ${message}`)

function currentStamp() {
  if (!existsSync(STAMP)) return undefined
  try {
    return JSON.parse(readFileSync(STAMP, 'utf8'))
  } catch {
    return undefined
  }
}

function upToDate() {
  const stamp = currentStamp()
  return (
    stamp?.revision === REVISION && stamp?.sha256 === SHA256 && existsSync(join(TREE, 'chrome.exe'))
  )
}

async function hashOf(path) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

async function download() {
  mkdirSync(VENDOR, { recursive: true })
  // A zip already here from an interrupted run is reused if it hashes right, and
  // replaced if it does not. Re-downloading 354 MB to discover it was already
  // correct is the kind of waste that gets a verification step skipped.
  if (existsSync(ZIP) && (await hashOf(ZIP)) === SHA256) {
    log('reusing the archive already downloaded')
    return
  }
  log(`downloading ${URL}`)
  const response = await fetch(URL)
  if (!response.ok || !response.body) {
    throw new Error(`download failed: HTTP ${response.status} ${response.statusText}`)
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(ZIP))
}

async function verify() {
  const actual = await hashOf(ZIP)
  if (actual !== SHA256) {
    // Deleted, not left behind: a mismatching archive on disk is the thing a
    // hurried second run would be tempted to reuse.
    unlinkSync(ZIP)
    throw new Error(
      `SHA256 mismatch for revision ${REVISION}\n  expected ${SHA256}\n  actual   ${actual}\n` +
        'Nothing was unpacked. Either the pin is wrong or the download is not what it claims.',
    )
  }
  log(`sha256 verified: ${SHA256}`)
}

function unpack() {
  if (existsSync(TREE)) {
    throw new Error(
      `${TREE} already exists but does not match the pin.\n` +
        'Delete it by hand and re-run - this script does not remove trees it did not just create.',
    )
  }
  log('unpacking')
  // .NET rather than Expand-Archive: measured at seconds against minutes, and it
  // rejects entries that would land outside the destination.
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
        `[System.IO.Compression.ZipFile]::ExtractToDirectory('${ZIP}', '${VENDOR}')`,
    ],
    { stdio: 'inherit' },
  )
}

function strip() {
  let removed = 0
  for (const name of NOT_SHIPPED) {
    const target = join(TREE, name)
    // Only a plain file, only directly inside the tree this run just unpacked.
    // Deleting is the most destructive thing any script in this repository does,
    // so it costs two lines to make a wrong entry fail instead of recurse.
    if (!existsSync(target)) continue
    if (!lstatSync(target).isFile()) {
      throw new Error(`refusing to remove ${target}: not a plain file`)
    }
    unlinkSync(target)
    removed++
  }
  log(`removed ${removed} of ${NOT_SHIPPED.length} files the app does not ship`)
}

function link() {
  if (!existsSync(ELECTRON_RESOURCES)) {
    log('electron is not installed here yet, so nothing was linked for development')
    log('run `node node_modules/electron/install.js`, then this script again')
    return
  }
  const existing = lstatSyncSafe(LINK)
  if (existing) {
    if (!existing.isSymbolicLink()) {
      throw new Error(`refusing to replace ${LINK}: it is a real directory, not a link`)
    }
    // Removed with rmdir, which is what Windows wants for a directory junction,
    // and never with a recursive delete - that would walk *through* the junction
    // into vendor/ and take the unpacked tree with it.
    rmdirSync(LINK)
  }
  symlinkSync(VENDOR, LINK, 'junction')
  log(`linked ${LINK} -> ${VENDOR}`)
}

/** `existsSync` follows the link; a dangling junction has to be found by lstat. */
function lstatSyncSafe(path) {
  try {
    return lstatSync(path)
  } catch {
    return undefined
  }
}

if (process.platform !== 'win32') {
  // Not an error. CI type-checks and tests on Linux and never needs the browser;
  // failing here would turn a green pipeline red for a file it does not use.
  log('not Windows - nothing to do')
  process.exit(0)
}

if (upToDate()) {
  log(`already at revision ${REVISION} (${VERSION})`)
  link()
  process.exit(0)
}

await download()
await verify()
unpack()
strip()
writeFileSync(
  STAMP,
  `${JSON.stringify({ revision: REVISION, version: VERSION, sha256: SHA256 }, null, 2)}\n`,
)
rmSync(ZIP, { force: true })
link()

const files = countFiles(TREE)
log(`ready: ${VERSION} (revision ${REVISION}), ${files.count} files, ${files.megabytes} MB`)

function countFiles(dir) {
  let count = 0
  let bytes = 0
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path)
      else {
        count++
        bytes += lstatSync(path).size
      }
    }
  }
  walk(dir)
  return { count, megabytes: Math.round(bytes / 1024 / 1024) }
}
