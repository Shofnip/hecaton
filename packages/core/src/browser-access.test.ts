import { describe, expect, it } from 'vitest'
import {
  ensureBrowserReadable,
  needsAppContainerGrant,
  type AppContainerReadState,
} from './browser-access.js'
import { FakeBrowserAccess, FakeLogger } from './testing/fakes.js'

describe('needsAppContainerGrant', () => {
  it('grants when the ACE is missing', () => {
    expect(needsAppContainerGrant('missing')).toBe(true)
  })

  it('does nothing when it is already there', () => {
    expect(needsAppContainerGrant('granted')).toBe(false)
  })

  it('grants when the state could not be read', () => {
    // The rule is "grant unless we positively know it is granted", and the
    // asymmetry is the decision: a redundant grant costs one icacls run, and a
    // skipped one costs every screen the user opens - they come up grey and no
    // page ever loads, with nothing on screen saying why.
    expect(needsAppContainerGrant('unknown')).toBe(true)
  })
})

describe('ensureBrowserReadable', () => {
  const dir = String.raw`C:\somewhere\chrome-win`

  it('grants the ACE on a tree that does not have it', async () => {
    const access = new FakeBrowserAccess('missing')
    const logger = new FakeLogger()

    await expect(ensureBrowserReadable({ access, browserDir: dir, logger })).resolves.toBe(
      'granted',
    )

    expect(access.granted).toEqual([dir])
  })

  it('leaves a tree that already has it alone', async () => {
    // Every launch after the first, and the reason this reads before it writes:
    // an unconditional grant would rewrite the ACL of 251 files on every start.
    const access = new FakeBrowserAccess('granted')
    const logger = new FakeLogger()

    await expect(ensureBrowserReadable({ access, browserDir: dir, logger })).resolves.toBe(
      'granted',
    )

    expect(access.granted).toEqual([])
    expect(logger.entries.map((entry) => entry.message)).toEqual(['already-readable'])
  })

  it('logs what it did, and never the path', async () => {
    // The browser tree sits inside the folder the user extracted, so its path
    // carries their account name. `redactUserPaths` would scrub it anyway - this
    // keeps it out of the message in the first place, which is the same reason
    // `instance.claim` logs a verdict and not an identity.
    const access = new FakeBrowserAccess('missing')
    const logger = new FakeLogger()

    await ensureBrowserReadable({ access, browserDir: dir, logger })

    expect(logger.entries).toEqual([{ level: 'info', event: 'browser.access', message: 'granted' }])
  })

  it('reports a failed grant instead of throwing', async () => {
    // Fail open, like every other layer that depends on the machine cooperating:
    // a folder this user cannot re-ACL is a broken instrument, and refusing to
    // start over it would turn a browser problem into no app at all. The screens
    // will be grey and the log line is what explains them.
    const access = new FakeBrowserAccess('missing')
    access.failGrant = new Error('Acesso negado')
    const logger = new FakeLogger()

    await expect(ensureBrowserReadable({ access, browserDir: dir, logger })).resolves.toBe(
      'missing',
    )

    expect(logger.entries).toEqual([
      { level: 'warn', event: 'browser.access', message: 'grant-failed: Acesso negado' },
    ])
  })

  it('grants anyway when the state cannot be read, and says so', async () => {
    const access = new FakeBrowserAccess('unknown')
    const logger = new FakeLogger()

    await expect(ensureBrowserReadable({ access, browserDir: dir, logger })).resolves.toBe(
      'granted',
    )

    expect(access.granted).toEqual([dir])
    expect(logger.entries.map((entry) => entry.message)).toEqual(['granted-unread'])
  })

  it('treats a read that throws as unknown rather than failing the launch', async () => {
    const access = new FakeBrowserAccess('granted')
    access.failRead = new Error('no such directory')
    const logger = new FakeLogger()

    const state: AppContainerReadState = await ensureBrowserReadable({
      access,
      browserDir: dir,
      logger,
    })

    expect(state).toBe('granted')
    expect(access.granted).toEqual([dir])
  })
})
