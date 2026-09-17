/**
 * The real ACL, on a real directory, through the real `icacls`.
 *
 * Here rather than in the fast suite because there is nothing to fake that would
 * prove anything: the whole question is what Windows does with an ACE, and a
 * fake `icacls` would only test the fake. The state it reads is the one Chromium
 * itself consults before starting its network service in an AppContainer.
 *
 * It works in a throwaway directory under %TEMP% and never touches the real
 * browser tree, so a failed run leaves nothing behind that matters.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IcaclsBrowserAccess } from './app-container-access.js'

const access = new IcaclsBrowserAccess()
const roots: string[] = []

function throwawayTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'hecaton-acl-'))
  roots.push(root)
  // A file as well as the directory: the grant is inheritable *and* recursive,
  // and only a child can tell those two apart.
  writeFileSync(join(root, 'chrome.exe'), 'not really a browser')
  return root
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe('IcaclsBrowserAccess', () => {
  it('reports a fresh temp directory as missing the ACE', async () => {
    // The premise of the whole fix. %TEMP% is inside the user profile, which
    // inherits nothing for application packages - measured 2026-09-17, and the
    // same was true of %LOCALAPPDATA%\Programs, which is why an installer would
    // not have solved it either.
    await expect(access.readState(throwawayTree())).resolves.toBe('missing')
  })

  it('grants the ACE, and reads it back', async () => {
    const root = throwawayTree()

    await access.grantRead(root)

    await expect(access.readState(root)).resolves.toBe('granted')
  })

  it('grants it to files already inside the tree, not just to new ones', async () => {
    // (OI)(CI) alone only writes an inheritable ACE onto the directory; the 251
    // files unpacked before it would keep the ACL they were created with. /T is
    // what reaches them, and chrome.exe is the one that has to be readable.
    const root = throwawayTree()

    await access.grantRead(root)

    await expect(access.readState(join(root, 'chrome.exe'))).resolves.toBe('granted')
  })

  it('is idempotent, so every launch after the first can call it', async () => {
    const root = throwawayTree()

    await access.grantRead(root)
    await access.grantRead(root)

    await expect(access.readState(root)).resolves.toBe('granted')
  })

  it('throws on a path that does not exist, rather than answering about it', async () => {
    // The core turns this into `unknown` and grants anyway. What matters here is
    // that the adapter does not invent `missing`, which would read as evidence.
    await expect(access.readState(join(tmpdir(), 'hecaton-acl-does-not-exist'))).rejects.toThrow()
  })
})
