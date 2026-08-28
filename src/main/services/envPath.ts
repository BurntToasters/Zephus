/**
 * Shared PATH environment key utility.
 *
 * Windows env keys are case-insensitive, so `PATH` may appear as `Path` or
 * `path`. This helper finds the canonical key for the running env.
 */

/** Returns the PATH-like key present in an env object (defaults to "PATH"). */
export function pathEnvKey(env: NodeJS.ProcessEnv): string {
  return Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
}
