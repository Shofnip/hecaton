import { describe, expect, it } from 'vitest'
import {
  canonicalMachineId,
  claimInstance,
  evaluateInstanceClaim,
  isVirtualMachine,
  sealToWrite,
} from './instance-claim.js'
import type { InstanceClaimFacts, MachineFacts, MachineSeal } from './instance-claim.js'
import { FakeInstanceLock, FakeLogger, FakeMachineIdentity, FakeStorage } from './testing/fakes.js'

/** The reference machine of probes P6/P6b: a physical ASUS desktop. */
const ASUS: MachineFacts = {
  manufacturer: 'ASUS',
  model: 'System Product Name',
  productUuid: '8F3A1C22-6B4D-11EE-9C1A-04421A1B2C3D',
  boardSerial: '230512345600123',
}

const ASUS_ID = 'uuid=8f3a1c22-6b4d-11ee-9c1a-04421a1b2c3d;board=230512345600123'

const facts = (overrides: Partial<InstanceClaimFacts> = {}): InstanceClaimFacts => ({
  virtualMachine: false,
  machineId: ASUS_ID,
  sealedMachineId: undefined,
  sealUnreadable: false,
  ...overrides,
})

describe('isVirtualMachine', () => {
  it('does not call the probe machine virtual', () => {
    // The named regression case. This desktop reports HypervisorPresent = True
    // (VBS and WSL2 put the host on top of Hyper-V), which is why that field is
    // not an input here at all: the naive check would refuse to start on the
    // owner's own machine. Manufacturer and model are what decide.
    expect(isVirtualMachine(ASUS)).toBe(false)
  })

  it('does not call an OEM placeholder model virtual', () => {
    // 'System Product Name' is what an OEM leaves in SMBIOS when nobody filled
    // the field in. It is not a hypervisor string, and a substring rule loose
    // enough to catch it would catch half the physical machines in the world.
    expect(isVirtualMachine({ ...ASUS, manufacturer: 'To Be Filled By O.E.M.' })).toBe(false)
  })

  it.each([
    ['VMware, Inc.', 'VMware Virtual Platform'],
    ['innotek GmbH', 'VirtualBox'],
    ['Oracle Corporation', 'VirtualBox'],
    ['QEMU', 'Standard PC (i440FX + PIIX, 1996)'],
    ['Xen', 'HVM domU'],
    ['Parallels Software International Inc.', 'Parallels Virtual Platform'],
    ['Microsoft Corporation', 'Virtual Machine'],
    ['Red Hat', 'KVM'],
    ['Google', 'Google Compute Engine'],
    ['Amazon EC2', 't3.large'],
  ])('recognises %s / %s', (manufacturer, model) => {
    expect(isVirtualMachine({ ...ASUS, manufacturer, model })).toBe(true)
  })

  it('does not mistake a Surface for a Hyper-V guest', () => {
    // Both report Microsoft Corporation as the manufacturer. Only the pair
    // separates them, so the Hyper-V rule may never match on manufacturer alone.
    expect(
      isVirtualMachine({ ...ASUS, manufacturer: 'Microsoft Corporation', model: 'Surface Pro 7' }),
    ).toBe(false)
  })

  it('does not mistake an Oracle server for VirtualBox', () => {
    expect(
      isVirtualMachine({ ...ASUS, manufacturer: 'Oracle Corporation', model: 'SUN FIRE X4170 M2' }),
    ).toBe(false)
  })

  it('ignores case and surrounding whitespace, as WMI returns them', () => {
    expect(
      isVirtualMachine({ ...ASUS, manufacturer: '  vmware, inc. ', model: ' whatever ' }),
    ).toBe(true)
  })
})

describe('canonicalMachineId', () => {
  it('joins the two fields probe P7 measured as real, lowercased', () => {
    expect(canonicalMachineId(ASUS)).toBe(ASUS_ID)
  })

  it('is stable across the whitespace and case WMI hands back', () => {
    expect(
      canonicalMachineId({ ...ASUS, productUuid: ' 8f3a1c22-6B4D-11EE-9C1A-04421A1B2C3D ' }),
    ).toBe(ASUS_ID)
  })

  it.each([
    'System Serial Number',
    'To be filled by O.E.M.',
    'Default string',
    'None',
    'Not Applicable',
    'Not Specified',
    '0',
    '',
    '   ',
  ])('drops the board serial when it is the placeholder %j', (boardSerial) => {
    // Measured in P7: BIOS.SerialNumber and IdentifyingNumber come back as
    // 'System Serial Number' on this very machine. A placeholder is shared by
    // every unit of a model, so treating one as identity would bind the lock to
    // a product line rather than to a machine.
    expect(canonicalMachineId({ ...ASUS, boardSerial })).toBe(
      'uuid=8f3a1c22-6b4d-11ee-9c1a-04421a1b2c3d',
    )
  })

  it.each([
    '00000000-0000-0000-0000-000000000000',
    'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF',
    'Not Specified',
    '',
  ])('has no identity at all when the product uuid is %j', (productUuid) => {
    // The uuid is the required half: without it there is nothing to bind to, and
    // a board serial alone is the field most likely to be an OEM placeholder.
    expect(canonicalMachineId({ ...ASUS, productUuid })).toBeUndefined()
  })
})

describe('evaluateInstanceClaim', () => {
  it('allows a free lock on an identified physical machine with no seal yet', () => {
    expect(evaluateInstanceClaim(facts())).toBe('allow')
  })

  it('allows when the seal on disk names this machine', () => {
    expect(evaluateInstanceClaim(facts({ sealedMachineId: ASUS_ID }))).toBe('allow')
  })

  it('refuses a virtual machine', () => {
    expect(evaluateInstanceClaim(facts({ virtualMachine: true }))).toBe('virtual-machine')
  })

  it('refuses when the seal names a different machine', () => {
    expect(evaluateInstanceClaim(facts({ sealedMachineId: 'uuid=someone-elses-machine' }))).toBe(
      'foreign-machine',
    )
  })

  it('refuses when the seal exists but cannot be read', () => {
    // A seal that will not parse is evidence, not an accident to paper over:
    // the file lives where a standard user cannot write it, so the ways it gets
    // there are a copied ProgramData tree or deliberate tampering.
    expect(evaluateInstanceClaim(facts({ sealUnreadable: true }))).toBe('foreign-machine')
  })

  it('names the virtual machine first when several reasons apply', () => {
    // Which reason is shown is a decision, not an accident of ordering. A VM is
    // the truest answer available: telling a VM user that their hardware seal
    // does not match sends them hunting the wrong thing entirely.
    expect(
      evaluateInstanceClaim(
        facts({
          virtualMachine: true,
          sealedMachineId: 'uuid=someone-elses-machine',
        }),
      ),
    ).toBe('virtual-machine')
  })

  it('allows when the machine could not be identified at all', () => {
    // Fail open, deliberately, and only here. An unreadable identity is this
    // app's own instrument failing — WMI refusing to answer — and refusing to
    // start over that punishes the user for a fault that is not theirs. A
    // mismatching seal is the opposite: positive evidence of something.
    expect(evaluateInstanceClaim(facts({ machineId: undefined }))).toBe('allow')
  })

  it('does not compare a seal it has no identity to compare against', () => {
    expect(
      evaluateInstanceClaim(facts({ machineId: undefined, sealedMachineId: 'uuid=whatever' })),
    ).toBe('allow')
  })

  it('does not refuse over an unreadable seal it has no identity to check', () => {
    // The other half of the same gate, and the half that was untested until a
    // documentation audit noticed the ADR claiming otherwise. Without it,
    // lifting the sealUnreadable branch out of the identity guard would refuse
    // every machine WMI cannot answer for, and the suite would stay green.
    expect(evaluateInstanceClaim(facts({ machineId: undefined, sealUnreadable: true }))).toBe(
      'allow',
    )
  })

  it('still refuses an unidentified machine that is virtual', () => {
    expect(evaluateInstanceClaim(facts({ machineId: undefined, virtualMachine: true }))).toBe(
      'virtual-machine',
    )
  })
})

describe('sealToWrite', () => {
  it('writes the identity the first time this machine runs the app', () => {
    expect(sealToWrite(facts())).toBe(ASUS_ID)
  })

  it('writes nothing when the seal is already there and matches', () => {
    expect(sealToWrite(facts({ sealedMachineId: ASUS_ID }))).toBeUndefined()
  })

  it('writes nothing when the machine could not be identified', () => {
    expect(sealToWrite(facts({ machineId: undefined }))).toBeUndefined()
  })

  it('never repairs a seal it just refused to match', () => {
    // The refusal has to be sticky. Overwriting a foreign seal would turn the
    // hardware binding into a formality: start once, get refused, and the second
    // launch succeeds because the first one rewrote the evidence.
    expect(sealToWrite(facts({ sealedMachineId: 'uuid=someone-elses-machine' }))).toBeUndefined()
    expect(sealToWrite(facts({ sealUnreadable: true }))).toBeUndefined()
  })
})

describe('claimInstance', () => {
  const deps = (
    overrides: {
      facts?: MachineFacts
      accountIds?: readonly number[]
      busyAccounts?: readonly number[]
      sealed?: MachineSeal
      failLoad?: Error
    } = {},
  ): {
    identity: FakeMachineIdentity
    lock: FakeInstanceLock
    seal: FakeStorage<MachineSeal>
    logger: FakeLogger
    accountIds: readonly number[]
  } => {
    const seal = new FakeStorage<MachineSeal>(overrides.sealed)
    seal.failLoad = overrides.failLoad
    const lock = new FakeInstanceLock()
    for (const id of overrides.busyAccounts ?? []) lock.busy.add(id)
    return {
      identity: new FakeMachineIdentity(overrides.facts ?? ASUS),
      lock,
      seal,
      logger: new FakeLogger(),
      accountIds: overrides.accountIds ?? [],
    }
  }

  it('creates the first account on a machine that has none, and seals it', async () => {
    const d = deps()

    await expect(claimInstance(d)).resolves.toEqual({
      verdict: 'allow',
      account: { id: 1, created: true },
    })

    expect(d.lock.claimed).toEqual([1])
    expect(d.seal.saves).toBe(1)
    // What lands on disk is the digest, never the canonical identity: the file
    // sits in a machine-wide directory every account can read.
    expect(await d.seal.load()).toEqual({ machineId: `digest(${ASUS_ID})` })
  })

  it('takes the existing account when nothing else is running', async () => {
    const d = deps({ accountIds: [1], sealed: { machineId: `digest(${ASUS_ID})` } })

    await expect(claimInstance(d)).resolves.toEqual({
      verdict: 'allow',
      account: { id: 1, created: false },
    })
    expect(d.seal.saves).toBe(0)
  })

  it('opens the second window on the second account', async () => {
    // The feature in one test: another window already holds account 1, so this
    // one takes account 2 rather than sharing a profile directory with it.
    const d = deps({ accountIds: [1, 2], busyAccounts: [1] })

    await expect(claimInstance(d)).resolves.toEqual({
      verdict: 'allow',
      account: { id: 2, created: false },
    })
    expect(d.lock.claimed).toEqual([1, 2])
  })

  it('creates a new account when every existing one is in use', async () => {
    const d = deps({ accountIds: [1], busyAccounts: [1] })

    await expect(claimInstance(d)).resolves.toEqual({
      verdict: 'allow',
      account: { id: 2, created: true },
    })
  })

  it('refuses to start when no account could be reserved', async () => {
    // The one place this feature does **not** fail open. Everywhere else a
    // broken instrument lets the app run anyway, because the cost is the app
    // being annoying. Here the cost is two windows writing one browser profile,
    // which damages a logged-in session - so a lock that will not answer stops
    // the launch instead.
    const d = deps({ accountIds: [1], busyAccounts: Array.from({ length: 40 }, (_, i) => i + 1) })

    await expect(claimInstance(d)).resolves.toEqual({ verdict: 'no-account' })
    expect(d.seal.saves).toBe(0)
  })

  it('takes no account at all when the machine itself is refused', async () => {
    // The machine gate runs first, so a refused launch never touches a lock and
    // never has one to release - which is what the old one-per-machine claim
    // needed a release path for.
    const d = deps({ facts: { ...ASUS, manufacturer: 'VMware, Inc.' } })

    await expect(claimInstance(d)).resolves.toEqual({ verdict: 'virtual-machine' })
    expect(d.lock.claimed).toEqual([])
    expect(d.seal.saves).toBe(0)
  })

  it('treats a seal that will not load as a foreign machine', async () => {
    const d = deps({ failLoad: new Error('EACCES') })
    await expect(claimInstance(d)).resolves.toEqual({ verdict: 'foreign-machine' })
  })

  it('treats a seal without a machine id as a foreign machine', async () => {
    // The file is JSON, so it parses; it just is not a seal. Anything that is
    // not the shape this app writes got there some other way.
    const d = deps({ sealed: { notAMachineId: true } as unknown as MachineSeal })
    await expect(claimInstance(d)).resolves.toEqual({ verdict: 'foreign-machine' })
  })

  it('starts anyway when the seal cannot be written', async () => {
    // The seal is evidence, not a gate on its own. Refusing to start because
    // ProgramData would not take a file turns a disk permission into a brick.
    const d = deps()
    d.seal.save = (): Promise<void> => Promise.reject(new Error('EACCES'))

    await expect(claimInstance(d)).resolves.toMatchObject({ verdict: 'allow' })
    expect(d.logger.events()).toContain('instance.seal-failed')
  })

  it('logs the verdict and never the machine id', async () => {
    // 'log contents' is a security trigger in this project, and a hardware id is
    // exactly the kind of value that must not sit in a file a user is asked to
    // send to someone else. The verdicts are words, not identifiers.
    const d = deps({ sealed: { machineId: 'digest(uuid=someone-elses-machine)' } })

    await claimInstance(d)

    const serialised = JSON.stringify(d.logger.entries)
    expect(serialised).toContain('foreign-machine')
    expect(serialised).not.toContain(ASUS.productUuid)
    expect(serialised).not.toContain(ASUS.boardSerial)
    expect(serialised).not.toContain(ASUS_ID)
    // Not the digest either. It is not a secret - anyone can recompute it from
    // their own machine - but it is still an identifier of one person's computer.
    expect(serialised).not.toContain('digest(')
  })

  it('logs which account it opened on, since that is not an identifier', async () => {
    const d = deps({ accountIds: [1], busyAccounts: [1] })

    await claimInstance(d)

    expect(d.logger.entries).toContainEqual({
      level: 'info',
      event: 'instance.account',
      message: 'created 2',
    })
  })

  it('refuses a machine whose seal digest does not match', async () => {
    const d = deps({ sealed: { machineId: 'digest(uuid=someone-elses-machine)' } })
    await expect(claimInstance(d)).resolves.toEqual({ verdict: 'foreign-machine' })
    expect(d.seal.saves).toBe(0)
  })

  it('seals nothing on a machine it could not identify', async () => {
    // No identity means no digest to store, and storing a digest of "nothing"
    // would seal every unidentifiable machine to the same value.
    const d = deps({ facts: { ...ASUS, productUuid: 'Not Specified' } })
    await expect(claimInstance(d)).resolves.toMatchObject({ verdict: 'allow' })
    expect(d.seal.saves).toBe(0)
  })

  it('reads the machine once', async () => {
    const d = deps()
    await claimInstance(d)
    expect(d.identity.reads).toBe(1)
  })
})
