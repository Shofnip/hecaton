/**
 * The digest half of the identity adapter, which is pure and therefore belongs
 * in the fast suite. Reading the machine is I/O and is covered next door, in the
 * integration test, against real WMI.
 */
import { describe, expect, it } from 'vitest'
import { WmiMachineIdentity } from './wmi-machine-identity.js'

const identity = new WmiMachineIdentity()

describe('WmiMachineIdentity.digest', () => {
  it('is stable for the same identity', () => {
    // The property the seal depends on. A digest that varied between runs would
    // refuse the machine on its second launch, every time.
    expect(identity.digest('uuid=abc;board=def')).toBe(identity.digest('uuid=abc;board=def'))
  })

  it('differs for different identities', () => {
    expect(identity.digest('uuid=abc')).not.toBe(identity.digest('uuid=xyz'))
  })

  it('does not contain the identity it was given', () => {
    // The point of hashing at all: the seal sits in a world-readable directory,
    // and the raw value is a hardware identifier of someone's computer.
    const digest = identity.digest('uuid=8f3a1c22-6b4d-11ee-9c1a-04421a1b2c3d')
    expect(digest).not.toContain('8f3a1c22')
    expect(digest).not.toContain('uuid')
  })

  it('is a plain lowercase sha256 in hex, pinned', () => {
    // Pinned to a literal rather than asserted to "look like a hash". Changing
    // the algorithm re-seals nothing and refuses every machine that already
    // carries a seal, so it has to be a decision someone makes on purpose - and
    // a test that only checked the shape would let a refactor make it silently.
    expect(identity.digest('hecaton')).toBe(
      '6b14835ae956b6af8b545063c68fb69e382831878b1996ae2341ca3e30a6ba36',
    )
  })
})
