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
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import fastConfig from '../vitest.config.js'
import integrationConfig from '../vitest.integration.config.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8')

/**
 * Parses a tsconfig, which is JSONC — the ones in this repository carry the
 * comments explaining why they exclude what they exclude.
 *
 * Only whole-line `//` comments are stripped, which is all these files use. A
 * general JSONC parser would have to respect strings, and buying that here
 * would mean a dependency for a test that reads three files we control.
 */
function readJsonc<T>(relative: string): T {
  const stripped = read(relative)
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n')
  return JSON.parse(stripped) as T
}

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

/**
 * Every workspace directory, derived from the `workspaces` globs rather than
 * from a hardcoded list.
 *
 * Deriving it matters more than it looks. `apps/*` is a workspace that held
 * nothing until the Electron shell arrived, and a test that iterated a
 * hardcoded `packages` would have kept passing while the first app went
 * uncompiled and untype-checked — the same shape of vacuous green this file
 * exists to catch.
 */
function findWorkspaceDirs(): string[] {
  const found: string[] = []
  for (const pattern of packageJson.workspaces) {
    const parent = pattern.replace(/\/\*$/, '')
    let entries
    try {
      entries = readdirSync(join(ROOT, parent), { withFileTypes: true })
    } catch {
      // A declared workspace with no directory yet is not a failure: `apps/`
      // was exactly that until phase 1.5.
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (!existsSync(join(ROOT, parent, entry.name, 'package.json'))) continue
      found.push(`${parent}/${entry.name}`)
    }
  }
  return found
}

describe('no workspace is left out of the build', () => {
  const rootTsconfig = JSON.parse(read('tsconfig.json')) as { references: { path: string }[] }
  const referenced = new Set(rootTsconfig.references.map((reference) => reference.path))
  const workspaces = findWorkspaceDirs()

  it('finds workspaces', () => {
    expect(workspaces.length).toBeGreaterThan(0)
  })

  it.each(workspaces.map((dir) => [dir] as const))(
    '%s is referenced by the root tsconfig',
    (dir) => {
      // An unreferenced workspace still passes `tsc --build` — by never being
      // compiled. It would only break once something imported it.
      expect(referenced).toContain(`./${dir}`)
    },
  )
})

describe('no workspace escapes the test type-check', () => {
  // The build tsconfig excludes *.test.ts, so tsconfig.test.json is the only
  // thing that type-checks test files. A workspace missing from its `include`
  // has tests that compile nowhere: a broken signature stays green until
  // someone reads it. This already happened once for every test file in the
  // repository, which is why tsconfig.test.json exists at all.
  const testTsconfig = readJsonc<{ include: string[] }>('tsconfig.test.json')
  const workspaces = findWorkspaceDirs()

  it.each(workspaces.map((dir) => [dir] as const))('%s is covered by tsconfig.test.json', (dir) => {
    expect(matchesAny(`${dir}/src/example.test.ts`, testTsconfig.include)).toBe(true)
  })
})
