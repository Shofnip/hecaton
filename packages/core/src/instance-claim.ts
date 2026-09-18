/**
 * What a launch is allowed to do on this machine, and which account it opens.
 *
 * This file used to enforce **one Hecaton per machine** (ADR-0018): a live
 * `Global\` mutex, a refusal to run inside a recognised hypervisor, and a
 * hardware seal on disk. The owner reversed the first of those three on
 * 2026-09-18 ([ADR-0021](../../../docs/adr/0021-several-windows-one-account-each.md)):
 * a person may run as many windows as they like, and the mutex changed job
 * rather than disappearing. It is now **one window per account**, which is the
 * narrowest form that still stops two browsers from sharing one
 * `--user-data-dir` and damaging a logged-in session.
 *
 * The other two layers stand, unchanged and for their original reasons.
 *
 * The order is the decision, and it is the same as before: the machine is judged
 * first, and only a machine that may run reserves anything. A refused launch
 * therefore takes no lock and has none to release - the release path the
 * one-per-machine claim needed is gone with the reason for it.
 *
 * Every fact below is gathered by an adapter and handed here already read. The
 * hashing of the identity is the adapter's too, so the core never reaches for
 * `node:crypto`.
 */

import type { Logger } from './log.js'
import { claimFreeAccount } from './accounts.js'
import type { InstanceLock, MachineIdentity, Storage } from './ports.js'

/** What WMI answered about this machine, verbatim — no trimming, no casing. */
export interface MachineFacts {
  /** `Win32_ComputerSystem.Manufacturer`. */
  manufacturer: string
  /** `Win32_ComputerSystem.Model`. */
  model: string
  /** `Win32_ComputerSystemProduct.UUID`. Empty when WMI would not answer. */
  productUuid: string
  /** `Win32_BaseBoard.SerialNumber`. Empty when WMI would not answer. */
  boardSerial: string
}

/** What the live lock said when the adapter tried to take it. */
export type InstanceLockState =
  | 'free'
  | 'held-by-this-user'
  | 'held-by-another-user'
  /**
   * The lock could not be taken **or** ruled out: the worker failed to start, or
   * did not answer in time.
   *
   * It exists because this is the one lock in the app that must not fail open.
   * While the mutex enforced a usage limit (ADR-0018) a broken worker reported
   * `free`, on the principle that the app's own instrument failing must not
   * charge the user. Now it guards a browser profile from a second window, and
   * answering `free` on a broken worker would hand two Chromes one
   * `--user-data-dir` - so it says so instead, and the launch stops.
   */
  | 'unavailable'

/** Everything the decision needs, all of it already read from the machine. */
export interface InstanceClaimFacts {
  virtualMachine: boolean
  /** This machine's canonical identity, or undefined when it could not be read. */
  machineId: string | undefined
  /** The identity in the seal on disk, or undefined when there is no seal yet. */
  sealedMachineId: string | undefined
  /** True when a seal file exists but could not be read or parsed. */
  sealUnreadable: boolean
}

/**
 * The answer. `allow` starts the app; every other value refuses it and names
 * the reason on the blocked window — the strings are verdicts, never
 * identifiers, which is what lets them go into the log (ADR-0018).
 */
export type InstanceClaimVerdict = 'allow' | 'virtual-machine' | 'foreign-machine' | 'no-account'

/**
 * Manufacturer/model markers of the hypervisors worth recognising.
 *
 * A denylist of strings, which ages by itself and gives a false negative to
 * anyone who customises their guest's SMBIOS. That is understood and accepted:
 * the alternative was measured and is worse. `HypervisorPresent` came back
 * **True on the owner's physical desktop** — VBS/Memory Integrity and WSL2 put
 * the host itself on Hyper-V — so the obvious check would have refused to start
 * on the very machine the app is developed on.
 *
 * `manufacturer` matches on its own only where the vendor sells nothing but
 * virtualisation. Microsoft and Oracle sell physical machines too (a Surface, a
 * Sun-lineage server), so those need the model as well or a real user is
 * refused.
 */
const HYPERVISOR_MANUFACTURERS = [
  'vmware',
  'innotek', // VirtualBox before Oracle renamed the SMBIOS strings
  'qemu',
  'xen',
  'parallels',
  'bochs',
  'bhyve',
  'nutanix',
  'amazon ec2',
  'alibaba cloud',
] as const

/** Pairs, for vendors that also ship metal. Both halves must match. */
const HYPERVISOR_PAIRS = [
  { manufacturer: 'microsoft', model: 'virtual machine' },
  { manufacturer: 'oracle', model: 'virtualbox' },
  { manufacturer: 'red hat', model: 'kvm' },
  { manufacturer: 'google', model: 'google compute engine' },
] as const

const normalize = (value: string): string => value.trim().toLowerCase()

/**
 * Whether these facts describe a machine running inside a hypervisor we know.
 *
 * Deliberately not "whether this is a VM" — it cannot answer that, and naming
 * it as if it could is how the naive check gets reintroduced.
 */
export function isVirtualMachine(facts: MachineFacts): boolean {
  const manufacturer = normalize(facts.manufacturer)
  const model = normalize(facts.model)
  if (HYPERVISOR_MANUFACTURERS.some((marker) => manufacturer.includes(marker))) return true
  return HYPERVISOR_PAIRS.some(
    (pair) => manufacturer.includes(pair.manufacturer) && model.includes(pair.model),
  )
}

/**
 * SMBIOS fields an OEM left unfilled, which every unit of a model then shares.
 *
 * Measured on the reference machine in P7: `BIOS.SerialNumber` and
 * `ComputerSystemProduct.IdentifyingNumber` both answer `System Serial Number`.
 * Binding the lock to one of these would bind it to a product line.
 */
const PLACEHOLDERS = new Set([
  '',
  '0',
  'none',
  'null',
  'default string',
  'to be filled by o.e.m.',
  'system serial number',
  'not applicable',
  'not specified',
  'unknown',
  'filled by oem',
  '00000000-0000-0000-0000-000000000000',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
])

const usable = (value: string): string | undefined => {
  const normalized = normalize(value)
  return PLACEHOLDERS.has(normalized) ? undefined : normalized
}

/**
 * This machine's identity, or undefined when it has none worth binding to.
 *
 * Only the two fields P7 measured as real are used. The ones it rejected stay
 * out, each for its own reason: `Win32_Processor.ProcessorId` is a CPUID
 * signature, **identical on every machine with that CPU model**;
 * `MachineGuid` in the registry is per Windows installation, so it survives no
 * reinstall and follows a cloned disk; `DiskDrive[0].SerialNumber` is real but
 * changes when a disk is swapped or merely re-enumerated.
 *
 * The uuid is required and the board serial is optional. A board serial alone is
 * the half most likely to be an OEM placeholder, and an identity that can shift
 * from "board only" to "uuid + board" after a BIOS update would refuse to start
 * on a machine that never changed.
 *
 * The result is a plain readable string, not a hash — hashing is the adapter's
 * job, since it is what owns `node:crypto`.
 */
export function canonicalMachineId(facts: MachineFacts): string | undefined {
  const uuid = usable(facts.productUuid)
  if (!uuid) return undefined
  const board = usable(facts.boardSerial)
  return board ? `uuid=${uuid};board=${board}` : `uuid=${uuid}`
}

/**
 * Whether this instance may run, and if not, which layer said no.
 *
 * The order the reasons are tested in is itself the decision. A hypervisor comes
 * first because it is the truest answer available — telling a VM user that their
 * hardware seal does not match sends them hunting the wrong thing entirely.
 *
 * Both answers are about the **machine**. Which account a launch opens on is a
 * separate question, asked after this one and only of a machine that may run.
 *
 * The single fail-open is an unreadable identity. That is this app's own
 * instrument failing, and refusing to start over it charges the user for a fault
 * that is not theirs. A seal that disagrees is the opposite — positive evidence.
 */
export function evaluateInstanceClaim(facts: InstanceClaimFacts): InstanceClaimVerdict {
  if (facts.virtualMachine) return 'virtual-machine'
  if (facts.machineId !== undefined) {
    if (facts.sealUnreadable) return 'foreign-machine'
    if (facts.sealedMachineId !== undefined && facts.sealedMachineId !== facts.machineId) {
      return 'foreign-machine'
    }
  }
  return 'allow'
}

/**
 * The identity to persist as this machine's seal, or undefined to write nothing.
 *
 * Written once, on the first allowed launch, and never rewritten. Never
 * rewriting is the part that carries weight: a seal repaired after a mismatch
 * would make the hardware binding a formality — refused once, allowed on the
 * next launch because the refusal fixed the evidence it was refusing over.
 *
 * A machine that is refused writes nothing at all, and neither does a launch
 * that could not reserve an account — the caller writes the seal only once the
 * whole claim has succeeded, so a refused launch leaves no trace.
 */
export function sealToWrite(facts: InstanceClaimFacts): string | undefined {
  if (evaluateInstanceClaim(facts) !== 'allow') return undefined
  if (facts.machineId === undefined) return undefined
  return facts.sealedMachineId === undefined ? facts.machineId : undefined
}

/**
 * What the hardware seal file holds, and the whole of it.
 *
 * One field, on purpose. This is the only thing the app writes outside its own
 * data directory, and every field added here is a field sitting in a
 * machine-wide location for every user of that machine to read. A user name, a
 * timestamp or a version would each be a small convenience and a new disclosure.
 */
export interface MachineSeal {
  machineId: string
}

/** What a successful claim hands back: the account this window now owns. */
export interface ClaimedAccount {
  id: number
  /** True when this launch is what brought the account into existence. */
  created: boolean
}

/** The answer: whether to run, and on which account. */
export interface InstanceClaim {
  verdict: InstanceClaimVerdict
  /** Present only when the verdict is `allow`. */
  account?: ClaimedAccount
}

/** Everything the claim needs from the outside world. */
export interface InstanceGuardDeps {
  identity: MachineIdentity
  /** The per-account lock. One window per account, which is all that is left of ADR-0018's first layer. */
  lock: InstanceLock
  /** The accounts already on disk, as the storage adapter found them. */
  accountIds: readonly number[]
  /** Backed by `C:\ProgramData\hecaton\machine.json`, machine-wide by design. */
  seal: Storage<MachineSeal>
  logger: Logger
}

/**
 * Takes the machine claim and answers whether this instance may run.
 *
 * Lives in the core, alongside the rule it applies, for the same reason the
 * orchestrator does: it makes decisions and reaches the world only through
 * ports, so the whole matrix - including the refusals - is exercised by the
 * fast suite with no mutex, no WMI and no disk.
 *
 * The lock is taken before the machine is read even though a hypervisor or a
 * foreign seal would refuse anyway. There is nothing to starve by doing so: a
 * machine-wide refusal refuses every instance on that machine equally, so no
 * legitimate launch is waiting behind this one.
 *
 * What goes in the log is the verdict and nothing else. The machine id is
 * derived from hardware and identifies a person's computer; a log file is the
 * thing this project asks users to send to a friend when something breaks
 * (ADR-0015), which is exactly why it may not be in one.
 */
export async function claimInstance(deps: InstanceGuardDeps): Promise<InstanceClaim> {
  const machine = await deps.identity.read()

  let sealedMachineId: string | undefined
  let sealUnreadable = false
  try {
    const stored = await deps.seal.load()
    if (stored === undefined) {
      // No file: this machine has simply never run the app.
      sealedMachineId = undefined
    } else if (typeof stored.machineId === 'string' && stored.machineId.length > 0) {
      sealedMachineId = stored.machineId
    } else {
      // Valid JSON that is not a seal. It parsed, so the disk is fine; something
      // put a file of the wrong shape in a path only this app writes.
      sealUnreadable = true
    }
  } catch {
    sealUnreadable = true
  }

  // The canonical identity never leaves this function: what is compared, and
  // what is stored, is its digest. The plaintext exists only long enough to be
  // hashed.
  const canonical = canonicalMachineId(machine)
  const facts: InstanceClaimFacts = {
    virtualMachine: isVirtualMachine(machine),
    machineId: canonical === undefined ? undefined : deps.identity.digest(canonical),
    sealedMachineId,
    sealUnreadable,
  }
  const verdict = evaluateInstanceClaim(facts)
  if (verdict !== 'allow') {
    deps.logger.log({ level: 'warn', event: 'instance.claim', message: verdict })
    return { verdict }
  }

  // Only now, and only for a machine that may run: which account is free.
  let account: ClaimedAccount
  try {
    account = await claimFreeAccount(deps.accountIds, async (id) => {
      const state = await deps.lock.claim(id)
      return state === 'free'
    })
  } catch (error) {
    // **The one place this app does not fail open**, and the exception is
    // deliberate. Everywhere else a broken instrument lets the launch through,
    // because the cost is the app being less careful than it meant to be. The
    // cost here is two windows writing one browser profile, which damages a
    // logged-in session - so a lock that will not answer stops the launch.
    deps.logger.log({
      level: 'error',
      event: 'instance.account-failed',
      message: error instanceof Error ? error.message : String(error),
    })
    deps.logger.log({ level: 'warn', event: 'instance.claim', message: 'no-account' })
    return { verdict: 'no-account' }
  }

  deps.logger.log({ level: 'info', event: 'instance.claim', message: 'allow' })
  // An account number is not an identifier of anybody: it says which of this
  // machine's workspaces a window opened on, which is the first thing a
  // diagnosis of "my screens are gone" needs.
  deps.logger.log({
    level: 'info',
    event: 'instance.account',
    message: `${account.created ? 'created' : 'opened'} ${account.id}`,
  })

  const machineId = sealToWrite(facts)
  if (machineId !== undefined) {
    try {
      await deps.seal.save({ machineId })
    } catch (error) {
      // A seal that cannot be written is a machine-wide directory refusing a
      // file, which says nothing about this user's right to run the app. The
      // layer degrades; the app does not.
      deps.logger.log({
        level: 'warn',
        event: 'instance.seal-failed',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return { verdict, account }
}
