/**
 * Guards the one place in the app where a channel name is written twice.
 *
 * main registers handlers by iterating IPC_CHANNELS, so it cannot drift. The
 * preload cannot: a sandboxed preload may only require `electron` and a few
 * built-ins, so importing the shared constant would fail at runtime and the
 * names have to be literals there.
 *
 * Reading the source is crude, and it is the only thing that turns "these two
 * lists agree today" into "these two lists cannot disagree". A renamed channel
 * with a stale preload would otherwise show up as a button that silently does
 * nothing.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { IPC_CHANNELS } from '@hecaton/core'

const source = readFileSync(fileURLToPath(new URL('./preload.cts', import.meta.url)), 'utf8')

/** Every 'quoted:string' that looks like a channel name. */
const referenced = new Set(
  [...source.matchAll(/'([a-z]+:[a-zA-Z]+)'/g)].map((match) => match[1] as string),
)

describe('the preload bridge', () => {
  it.each(IPC_CHANNELS.map((channel) => [channel] as const))('invokes %s', (channel) => {
    expect(referenced).toContain(channel)
  })

  it('invokes nothing else', () => {
    // A channel here that main does not register is a method that always
    // rejects - and it would look like a bug in the feature rather than in the
    // contract.
    for (const channel of referenced) {
      expect(IPC_CHANNELS).toContain(channel)
    }
  })

  it('found channels at all', () => {
    // Guards the regex: if it stopped matching, every assertion above would
    // pass vacuously.
    expect(referenced.size).toBeGreaterThan(0)
  })
})
