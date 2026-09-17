/**
 * Logging: the shapes and the redaction, kept pure and in the core.
 *
 * Writing the file is an adapter's job. What may be written is a decision, and
 * decisions live here — most of all this one, because "log contents" is a
 * security trigger in this project: a page url can carry a session token in its
 * query string, and a log line is the easiest way for one to end up somewhere
 * it should not be.
 *
 * The rule is absolute: no url reaches the log, in any form. Not as a field —
 * the entry type has none — and not inside a message, which is why redaction
 * scrubs the message text rather than trusting callers to keep urls out of it.
 * Several of this project's own error messages embed the offending url.
 *
 * A second thing is scrubbed for the same reason, added by the security review
 * of 2026-09-17: the Windows user directory, which is where the account name
 * sits. A log is the file this project asks people to hand to a friend, and the
 * launcher's own timeout message quotes the profile path.
 */

export type LogLevel = 'info' | 'warn' | 'error'

/**
 * One thing worth recording. Deliberately small, and deliberately without a url
 * field: the slotId identifies the slot, and its target lives in the user's own
 * config, so the url would only duplicate what a diagnosis already has while
 * risking the one value that must never be logged.
 */
export interface LogEntry {
  level: LogLevel
  /** A dotted event name, e.g. 'slot.start', 'slot.crash', 'config.error'. */
  event: string
  slotId?: number
  gameId?: string
  pid?: number
  message?: string
}

/** The port the orchestrator logs through. The adapter writes; the core decides. */
export interface Logger {
  log(entry: LogEntry): void
}

const URL_PATTERN = /https?:\/\/[^\s'"]+/g

/** `C:\\Users\\<name>`, in either slash and any casing. The name is the point. */
const USER_DIRECTORY = /[A-Za-z]:[\\/]users[\\/][^\\/\s'"]+/gi

/**
 * Replaces every http(s) url in a string with a placeholder.
 *
 * A bare protocol like `http:` is left alone: it names no host and carries no
 * token, and it is usually the actual diagnosis ("url must use https, got
 * http:"). Only a full `scheme://…` is redacted, and all of it goes — host and
 * path as well as the query — because none of it is needed and the host would
 * only duplicate the user's own config.
 */
export function redactUrls(text: string): string {
  return text.replace(URL_PATTERN, '[url]')
}

/**
 * The Windows user directory, wherever it appears in a string.
 *
 * `C:\\Users\\<name>` and nothing below it: the account name is the identifying
 * part, and everything after it — which slot's profile, whether it was the
 * throwaway one under Temp — is the whole diagnostic value of a path. Any drive
 * letter, either separator, any casing, because that is what Windows hands back.
 *
 * The bare directory with no name after it is left alone. Nothing identifies
 * anybody there, and rewriting it would make a message *about* the directory
 * unreadable.
 */
export function redactUserPaths(text: string): string {
  return text.replace(USER_DIRECTORY, '[user]')
}

/**
 * How many daily files survive a prune. Fourteen is two weeks of history, which
 * is longer than any "it broke yesterday" conversation and short enough that the
 * directory does not grow without end on someone else's disk.
 */
export const LOG_FILES_KEPT = 14

/** Exactly what `FileLogger` writes: `app-YYYY-MM-DD.log` and nothing else. */
const LOG_FILE = /^app-\d{4}-\d{2}-\d{2}\.log$/

/**
 * Which files in the logs directory may be deleted, newest kept.
 *
 * A deleting path, so the decision is here rather than in the adapter, and it
 * says **which names** rather than "everything older than N". That matters more
 * than it looks: the panel offers a button that opens this directory, so a user
 * can have anything sitting in it — a copy they made, a file a friend sent to
 * compare. Only a name this logger itself could have written is ever returned,
 * whatever the keep count is.
 *
 * Sorted by name, which is sorting by date, because the name is an ISO date.
 * `readdir` order is the filesystem's business and not a promise.
 */
export function expiredLogFiles(names: readonly string[], keep: number): string[] {
  return names
    .filter((name) => LOG_FILE.test(name))
    .sort()
    .reverse()
    .slice(keep)
}

/** A written log line: a plain object, ready to serialise. */
export interface LogRecord {
  ts: string
  level: LogLevel
  event: string
  slotId?: number
  gameId?: string
  pid?: number
  message?: string
}

/**
 * Turns an entry into the record that gets written.
 *
 * Rebuilt field by field rather than spread, for the same reason the registry
 * validator is: a caller reaching past the types must not be able to smuggle a
 * url — or anything else — onto the record. Absent fields are omitted rather
 * than written as undefined, so a custom slot's line does not carry an empty
 * gameId.
 */
export function formatLogRecord(entry: LogEntry, timestamp: string): LogRecord {
  const record: LogRecord = { ts: timestamp, level: entry.level, event: entry.event }
  if (entry.slotId !== undefined) record.slotId = entry.slotId
  if (entry.gameId !== undefined) record.gameId = entry.gameId
  if (entry.pid !== undefined) record.pid = entry.pid
  if (entry.message !== undefined) record.message = redactUserPaths(redactUrls(entry.message))
  return record
}
