/**
 * Host half of the session-cost pill.
 *
 * The feature is entirely a browser half: this row exists so the client module
 * scanner can find `dsh.client` on the package and serve `lib/client.js`.
 * Keep it side-effect free — it must not touch the model, tools, or Session.
 */

/** Host plugin body: intentionally empty. */
export function apply() {}
