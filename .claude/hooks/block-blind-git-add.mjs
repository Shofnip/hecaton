#!/usr/bin/env node
/**
 * PreToolUse hook: refuses `git add -A`, `git add .`, `git add -u` and
 * `git commit -a`, requiring explicit file paths instead.
 *
 * Why: in this repository a `git add -A` once swept in files that had been
 * created by another process and never read, and pushed them. No shell check
 * can tell "reviewed" from "swept up" — but naming each path is what forces
 * the list to be looked at, so the fix is to remove the blind form.
 *
 * `git commit -a` is covered too: blocking the first and allowing the second
 * would leave the same hole through a different door.
 *
 * Written as a file rather than an inline command because jq is not installed
 * here, and because a hook nobody can read is a hook nobody will maintain.
 */

const DANGEROUS_ADD = /(^|[\s;&|(])git\s+add\s+([^;&|]*\s)?(-A|--all|-u|--update|\.)(\s|$)/
const DANGEROUS_COMMIT = /(^|[\s;&|(])git\s+commit\s+([^;&|]*\s)?-[a-zA-Z]*a[a-zA-Z]*(\s|$)/

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  )
  process.exit(0)
}

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => (input += chunk))
process.stdin.on('end', () => {
  let command = ''
  try {
    command = JSON.parse(input)?.tool_input?.command ?? ''
  } catch {
    process.exit(0) // Not our business to fail the tool over unparsable input.
  }

  if (DANGEROUS_ADD.test(command)) {
    deny(
      'Blocked: `git add` with -A, --all, -u or `.` stages files blindly. ' +
        'This repository once pushed files that were never read that way. ' +
        'Run `git status --short`, read anything unfamiliar, then stage explicit paths: ' +
        '`git add path/one.ts path/two.md`.',
    )
  }

  if (DANGEROUS_COMMIT.test(command)) {
    deny(
      'Blocked: `git commit -a` stages every modified file without review, ' +
        'which is the same hole as `git add -A`. Stage explicit paths first, then commit.',
    )
  }

  process.exit(0)
})
