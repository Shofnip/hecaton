/**
 * One running Hecaton per Windows machine: the whole rule, pure and testable.
 *
 * The reason this exists is not data protection — it is a limit on how much one
 * person can run, decided by the owner and recorded in ADR-0018. That matters
 * for reading the code: the checks below are aimed at a user who is not trying
 * to defeat them, because a determined one always wins. The source is public
 * under Apache-2.0 (ADR-0013), so any gate here can be deleted and rebuilt.
 * What the layers buy is that circumventing has to be deliberate.
 *
 * Three cumulative layers, none of which is sufficient alone:
 *
 *   1. a live `Global\` mutex — one process at a time across every logon session;
 *   2. a refusal to run inside a recognised hypervisor;
 *   3. a hardware seal on disk, so moving the app's state to another machine is
 *      detectable.
 *
 * The ceiling, measured and written down once so a later session does not read
 * it as a bug: two VMs on one host share nothing a guest can see, and two
 * Windows installations dual-booting share no `ProgramData`. What is actually
 * delivered is one instance per *Windows installation*, plus the two layers
 * above. Layer 3 adds little enforcement on top of 1 and 2; what it adds is
 * evidence.
 *
 * Every fact below is gathered by an adapter and handed here already read. The
 * hashing of the identity is the adapter's too, so the core never reaches for
 * `node:crypto`.
 */

import type { Logger } from './log.js'
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
export type InstanceLockState = 'free' | 'held-by-this-user' | 'held-by-another-user'

/** Everything the decision needs, all of it already read from the machine. */
export interface InstanceClaimFacts {
  lock: InstanceLockState
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
export type InstanceClaimVerdict =
  'allow' | 'held-by-this-user' | 'held-by-another-user' | 'virtual-machine' | 'foreign-machine'

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
 * first because it is the truest answer available — telling a VM user that
 * another user holds the lock sends them hunting a process that does not exist.
 * The seal comes before the lock for the same reason: a machine that fails the
 * hardware check fails it on every launch, so reporting a transient "occupied"
 * would send them to reboot instead of to the one thing that fixes it.
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
  if (facts.lock !== 'free') return facts.lock
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
 * A verdict other than `allow` writes nothing at all, including the lock cases,
 * so a second instance racing the first cannot touch the file.
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

/** Everything the claim needs from the outside world. */
export interface InstanceGuardDeps {
  identity: MachineIdentity
  lock: InstanceLock
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
export async function claimInstance(deps: InstanceGuardDeps): Promise<InstanceClaimVerdict> {
  const lock = await deps.lock.claim()
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
    lock,
    virtualMachine: isVirtualMachine(machine),
    machineId: canonical === undefined ? undefined : deps.identity.digest(canonical),
    sealedMachineId,
    sealUnreadable,
  }
  const verdict = evaluateInstanceClaim(facts)
  deps.logger.log({
    level: verdict === 'allow' ? 'info' : 'warn',
    event: 'instance.claim',
    message: verdict,
  })

  if (verdict !== 'allow') {
    // Released rather than held to process exit, so the reason survives a second
    // attempt: still holding it would make the next launch report the lock
    // instead of the hypervisor or the seal that actually refused this one.
    await deps.lock.release()
    return verdict
  }

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
  return verdict
}
