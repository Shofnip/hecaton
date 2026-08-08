/**
 * When the app has to show its terms warning.
 *
 * The warning itself is UI text and lives in the renderer, in Portuguese like
 * every other string a user reads. What lives here is the *rule* — whether it is
 * due — because that is a decision, it has to survive being read from an
 * untrusted config file, and the fast suite is where it belongs.
 *
 * Why it exists at all is D3b: the product's central capability, several accounts
 * of one game side by side, is what most game terms restrict, and the ban lands
 * on the user rather than on the author. It was to appear in three places —
 * README, first run, and the installer's licence page. There is no installer any
 * more, and a zip carries no README, so first run is the only one of the three a
 * user cannot miss.
 */

/**
 * Bumped when the warning's text changes materially — new rules read, a stricter
 * summary, a different game.
 *
 * A version rather than a boolean, and the difference is the whole point: the
 * text summarises rules that were read on a date, and D3b's argument for showing
 * it is that it can still change what the user decides. That argument only holds
 * if a text they have never read is shown again instead of being assumed read.
 */
export const TERMS_VERSION = 1

/**
 * Whether the warning is due, given the version the user last acknowledged.
 *
 * A value beyond the current one — a hand-edited config, or a file from a newer
 * build — is left alone rather than treated as suspicious. This is a warning, not
 * a gate: there is nothing to defend, and re-showing it over a large number would
 * be noise.
 */
export function needsTermsAcknowledgement(acknowledged: number): boolean {
  return acknowledged < TERMS_VERSION
}
