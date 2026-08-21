/**
 * What the machine says about itself, read once through WMI.
 *
 * A one-shot shell-out, unlike the window and audio adapters' persistent
 * workers: this runs exactly once per app launch, before the panel exists, so
 * there is nothing to amortise and a long-lived process would only be something
 * else to shut down.
 *
 * It holds no judgement. Which fields count as identity, which manufacturer
 * strings mean a hypervisor, what a placeholder looks like — all of that is in
 * `instance-claim.ts` in the core. This returns the four strings verbatim.
 *
 * Which four is the finding of probe P7, and the ones left out matter as much as
 * the ones kept: `BIOS.SerialNumber` and `ComputerSystemProduct.IdentifyingNumber`
 * both answered `System Serial Number` on the reference machine (an OEM
 * placeholder), and `Win32_Processor.ProcessorId` is a CPUID signature that is
 * identical on every machine carrying the same CPU model.
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import type { MachineFacts, MachineIdentity } from '@hecaton/core'

const run = promisify(execFile)

/**
 * Three CIM classes, one process, one JSON object out.
 *
 * `Get-CimInstance` rather than the deprecated `Get-WmiObject`, and
 * `-ErrorAction SilentlyContinue` on each so one class refusing to answer costs
 * that field and not the whole read. Everything is coerced to a string here so
 * the adapter never has to decide what a missing value means — the core's
 * placeholder rules already treat an empty string as "no answer".
 */
const SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$cs = Get-CimInstance Win32_ComputerSystem
$product = Get-CimInstance Win32_ComputerSystemProduct
$board = Get-CimInstance Win32_BaseBoard
[pscustomobject]@{
  manufacturer = [string]$cs.Manufacturer
  model        = [string]$cs.Model
  productUuid  = [string]$product.UUID
  boardSerial  = [string]$board.SerialNumber
} | ConvertTo-Json -Compress
`

/** What a machine that would not answer looks like. Never a partial object. */
const NOTHING: MachineFacts = {
  manufacturer: '',
  model: '',
  productUuid: '',
  boardSerial: '',
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

export class WmiMachineIdentity implements MachineIdentity {
  /**
   * The executable is a parameter for one reason: the integration test has to be
   * able to prove that a failing read returns empty facts rather than throwing.
   * Production never passes one.
   */
  constructor(private readonly powershell: string = 'powershell') {}

  async read(): Promise<MachineFacts> {
    try {
      const { stdout } = await run(
        this.powershell,
        [
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(SCRIPT, 'utf16le').toString('base64'),
        ],
        { windowsHide: true, timeout: 15_000 },
      )
      const parsed = JSON.parse(stdout) as Record<string, unknown>
      return {
        manufacturer: text(parsed['manufacturer']),
        model: text(parsed['model']),
        productUuid: text(parsed['productUuid']),
        boardSerial: text(parsed['boardSerial']),
      }
    } catch {
      // Swallowed on purpose, and the port says so. This runs before the panel
      // exists, so a throw here is a window that never opens; empty facts, by
      // contrast, mean the core simply finds no identity and lets the app start.
      // Nothing is logged either: the failure is not actionable by the user, and
      // a WMI error message is the kind of string that carries machine detail.
      return NOTHING
    }
  }

  /**
   * sha256, hex, no salt.
   *
   * Unsalted is deliberate rather than an oversight. A salt would have to be
   * either shipped in the binary — where the public source puts it in everyone's
   * hands — or stored beside the seal, where deleting one deletes both. The
   * digest is not defending a secret; it is stopping a world-readable file from
   * spelling out someone's hardware identifiers.
   */
  digest(canonicalId: string): string {
    return createHash('sha256').update(canonicalId, 'utf8').digest('hex')
  }
}
