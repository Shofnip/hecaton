import { beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const onWindows = process.platform === 'win32'
const shellRoot = join(import.meta.dirname, '..', '..')
const repoRoot = join(shellRoot, '..', '..')
const fixture = join(import.meta.dirname, 'overlay-tracking.integration.fixture.cjs')
const electronPath = createRequire(import.meta.url)('electron') as string

describe.skipIf(!onWindows)('real overlay bounds tracking', () => {
  beforeAll(() => {
    execFileSync(
      process.execPath,
      [
        join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
        '--build',
        join(shellRoot, 'tsconfig.json'),
      ],
      {
        cwd: repoRoot,
        stdio: 'pipe',
      },
    )
  })

  it('does no native bounds work while hidden and catches up before opening', () => {
    const output = execFileSync(electronPath, [fixture], {
      cwd: shellRoot,
      encoding: 'utf8',
      timeout: 20_000,
    })
    const line = output.split(/\r?\n/).find((candidate) => candidate.startsWith('OVERLAY_RESULT '))
    expect(line).toBeDefined()
    const result = JSON.parse(line!.slice('OVERLAY_RESULT '.length)) as Record<
      'initial' | 'hidden' | 'opened' | 'visible' | 'content',
      { x: number; y: number; width: number; height: number }
    >

    expect(result.hidden).toEqual(result.initial)
    expect(result.opened).not.toEqual(result.hidden)
    expect(result.visible).toEqual(result.content)
  })
})
