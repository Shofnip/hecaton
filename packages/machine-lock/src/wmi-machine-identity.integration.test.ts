/**
 * Reading the machine, against real WMI.
 *
 * Every assertion here is about **shape**, never about a value. Probe P7 set
 * that discipline — it reported field lengths and prefixes rather than the
 * identifiers themselves — and a test is a worse place to break it than a probe:
 * a failure message prints what it compared, and CI logs are kept.
 */
import { describe, expect, it } from 'vitest'
import { canonicalMachineId } from '@hecaton/core'
import { WmiMachineIdentity } from './wmi-machine-identity.js'

describe('WmiMachineIdentity.read', () => {
  it('answers with every field the decision needs', async () => {
    const facts = await new WmiMachineIdentity().read()

    expect(typeof facts.manufacturer).toBe('string')
    expect(typeof facts.model).toBe('string')
    expect(facts.manufacturer.length).toBeGreaterThan(0)
    expect(facts.model.length).toBeGreaterThan(0)
    // The uuid is the required half of the identity. A machine that cannot
    // produce one is allowed to run — it just gets no seal — so this asserts the
    // *reader* works, which is the part that could regress silently.
    expect(facts.productUuid).toMatch(/^[0-9a-fA-F-]{36}$/)
  })

  it('produces an identity the core accepts', async () => {
    const facts = await new WmiMachineIdentity().read()
    expect(canonicalMachineId(facts)).toBeDefined()
  })

  it('never throws, whatever WMI does', async () => {
    // The port promises this, and the promise is load-bearing: an exception here
    // happens before the panel exists, so it would surface as a window that
    // never opens rather than as any message at all.
    const identity = new WmiMachineIdentity('this-is-not-a-powershell-executable')
    const facts = await identity.read()
    expect(facts).toEqual({ manufacturer: '', model: '', productUuid: '', boardSerial: '' })
  })
})
