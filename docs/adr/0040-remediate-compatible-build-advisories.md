# ADR-0040 — Remediate compatible build advisories

**Status:** Accepted · **Date:** 2026-09-22

## Context

The shipped dependency tree remained clean, but a full `npm audit` found nine development/build
advisories. They included file read, SSRF, injection and information disclosure, so ADR-0013's
historical rationale that the accepted remainder was only denial of service no longer described
the current tree.

The options were to keep blanket acceptance, force or override transitive versions, or take only
the compatible updates npm could resolve without moving a pinned direct dependency to a new major.

## Decision

Apply the compatible patch/minor resolution without `--force` or overrides, and raise the direct
Vitest floor from `^4.1.10` to the fixed `^4.1.11`. The resulting full audit, not only
`--omit=dev`, is clean. Future build advisories are reviewed by their actual reachability and fix;
they are not accepted by category.

The release gate remains `npm audit --omit=dev`: it answers whether the artifact's npm tree is
safe, stays independent of development-only registry churn, and does not cover the separately
pinned Chromium. A full audit belongs to dependency/security review.

## Consequences

- No production dependency, Electron major, packaging format or application behavior changed.
- The lockfile moved compatible Vitest/Vite and transitive build packages together, then the full
  fast and integration suites revalidated the combination.
- `npm audit fix --force` remains rejected; a future fix requiring a major is a new owner decision.
