/**
 * Checks that the project's own verification machinery covers what it claims to.
 *
 * Three real failures motivated this, all of the same shape — a quality signal
 * that looked broader than it was, and none of which announced itself:
 *
 *   - a CI job that ran `npm run test:integration --if-present` before that
 *     script existed, booting a Windows runner and reporting green without
 *     running a single test;
 *   - `npm run check` documented as "what CI runs" while CI also ran
 *     `format:check`, so a green check could still fail CI;
 *   - `*.test.ts` excluded from the build tsconfig and therefore never
 *     type-checked at all.
 *
 * Each was found by someone looking closely. These tests are the cheap,
 * deterministic part of that job: code against code, no judgement required,
 * running in milliseconds on every commit.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import fastConfig from '../vitest.config.js'
import integrationConfig from '../vitest.integration.config.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8')

const packageJson = JSON.parse(read('package.json')) as {
  scripts: Record<string, string>
  workspaces: string[]
}

/** Minimal glob matcher covering the `**` and `*` used in the Vitest configs. */
function globToRegExp(glob: string): RegExp {
  const source = glob
    .split('/')
    .map((segment) => {
      if (segment === '**') return '(?:.+)?'
      return segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')
    })
    .join('/')
    .replace(/\(\?:\.\+\)\?\//g, '(?:.+/)?')
  return new RegExp(`^${source}$`)
}

const matchesAny = (path: string, globs: readonly string[]): boolean =>
  globs.some((glob) => globToRegExp(glob).test(path))

/** Every *.test.ts in the repository, as forward-slashed paths relative to root. */
function findTestFiles(dir = '', found: string[] = []): string[] {
  const skip = new Set(['node_modules', 'dist', '.git', '.husky', 'coverage'])
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (skip.has(entry.name)) continue
    const relative = dir ? `${dir}/${entry.name}` : entry.name
    if (entry.isDirectory()) findTestFiles(relative, found)
    else if (entry.name.endsWith('.test.ts')) found.push(relative)
  }
  return found
}

describe('npm run check covers everything CI runs', () => {
  // The check script is documented in CLAUDE.md and README.md as "what CI runs".
  // If CI grows a step that check does not have, a green local run stops meaning
  // a green CI, which is the entire value of the claim.
  const ciWorkflow = read('.github/workflows/ci.yml')
  const check = packageJson.scripts['check'] ?? ''

  const ciCommands = [...ciWorkflow.matchAll(/^\s*-\s*run:\s*(npm .+)$/gm)]
    .map((match) => match[1]!.trim())
    // `npm ci` is environment setup, not a verification step.
    .filter((command) => !command.startsWith('npm ci'))

  it('finds the verification steps in the workflow', () => {
    // Guards the regex above: if the workflow format changes and nothing is
    // matched, the test below would pass vacuously.
    expect(ciCommands.length).toBeGreaterThan(0)
  })

  it.each(ciCommands.map((command) => [command] as const))('check runs %s', (command) => {
    // `npm test` and `npm run test` are the same script.
    const script = command.replace(/^npm (run )?/, '').split(' ')[0]!
    expect(check).toContain(script)
  })
})

describe('no test file is orphaned', () => {
  const testFiles = findTestFiles()

  it('finds test files at all', () => {
    expect(testFiles.length).toBeGreaterThan(0)
  })

  it.each(testFiles.map((file) => [file] as const))('%s is picked up by a config', (file) => {
    // A test file matching no config never runs, and nothing else would say so:
    // the suite stays green because the file is simply invisible.
    const fast = fastConfig.test!
    const integration = integrationConfig.test!

    const inFast =
      matchesAny(file, fast.include as string[]) &&
      !matchesAny(file, (fast.exclude as string[]) ?? [])
    const inIntegration = matchesAny(file, integration.include as string[])

    expect(inFast || inIntegration).toBe(true)
  })

  it('routes integration tests to the integration config only', () => {
    // The fast suite must stay free of I/O; an integration test leaking into it
    // would launch Chrome during the red-green loop.
    for (const file of testFiles.filter((f) => f.endsWith('.integration.test.ts'))) {
      expect(matchesAny(file, (fastConfig.test!.exclude as string[]) ?? [])).toBe(true)
    }
  })
})

describe('no package is left out of the build', () => {
  const rootTsconfig = JSON.parse(read('tsconfig.json')) as { references: { path: string }[] }
  const referenced = new Set(rootTsconfig.references.map((reference) => reference.path))

  const packages = readdirSync(join(ROOT, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)

  it('finds packages', () => {
    expect(packages.length).toBeGreaterThan(0)
  })

  it.each(packages.map((name) => [name] as const))(
    'packages/%s is referenced by the root tsconfig',
    (name) => {
      // An unreferenced package still passes `tsc --build` — by never being
      // compiled. It would only break once something imported it.
      expect(referenced).toContain(`./packages/${name}`)
    },
  )
})
