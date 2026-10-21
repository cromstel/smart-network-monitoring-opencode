/**
 * The application's public identity, read from the environment.
 *
 * The name appeared as four independent literals — the document `<title>`, the
 * sidebar heading, the login-page subtitle, and the `package.json` name — plus
 * a fifth variant (`home_monitor`) as the default database name. Renaming the
 * product meant finding all of them, and missing one produced a half-renamed
 * app: a correctly titled browser tab above a sidebar still showing the old
 * name.
 *
 * ## There is no built-in name
 *
 * An earlier version of this module carried `DEFAULT_APP_NAME = 'Home Network
 * Monitor'` and fell back to it. That is exactly the hardcoding it was meant to
 * remove — a white-labelled deployment that forgot `APP_NAME` would ship
 * branded as somebody else's product, and the mistake is invisible because the
 * fallback looks intentional. `APP_NAME` is now required, the same way the
 * database credentials are: a missing identity is a startup error, not a
 * silent default.
 *
 * ## Read at request time, never at module load
 *
 * `next build` evaluates this module in a build worker where the deployment's
 * environment is not present. A top-level read would bake the build-time value
 * into the static HTML and the environment variable would appear to do nothing
 * on the server that actually serves the page. Next inlines `process.env.*` at
 * build time only for `NEXT_PUBLIC_*`; everything else must be read when
 * rendered.
 */

/** Thrown when a required identity variable is absent, naming the variable. */
export class MissingAppIdentityError extends Error {
  constructor(variable: string) {
    super(
      `Missing required environment variable: ${variable}. ` +
        `Set it in .env.local (or the deployment's environment) — see .env.example.`
    )
    this.name = 'MissingAppIdentityError'
  }
}

function required(name: string, value: string | undefined): string {
  const trimmed = value?.trim()
  if (!trimmed) throw new MissingAppIdentityError(name)
  return trimmed
}

/**
 * The application name for the current process.
 *
 * Read at call time, not import time, for the reason above. A blank or
 * whitespace-only value is treated as absent rather than rendering an empty
 * `<title>` or a sidebar with no heading.
 *
 * ## How this relates to `loadConfig`
 *
 * `lib/config.ts` validates the same variable in its schema, and its result is
 * cached for the life of the process. This function deliberately does *not*
 * use that cached copy: build workers, tests and the seed scripts change
 * `process.env.APP_NAME` after the first read, and a frozen value would make
 * the app render a name nobody currently configured. Two consequences:
 *
 *   - This is the request-time accessor; the schema is the boot-time
 *     fail-fast. Both exist, neither is redundant.
 *   - Because the same rule is written twice, `lib/__tests__/appIdentity.test.ts`
 *     pins them together: any value one rejects, the other rejects too.
 */
export function appName(): string {
  return required('APP_NAME', process.env.APP_NAME)
}

/**
 * The MySQL schema name.
 *
 * Deliberately separate from `appName()`: the display name is customer-facing
 * and may contain spaces and capitals, while a schema name may not. Deriving
 * one from the other would produce a schema called `home_network_monitor` for a
 * database the operator already named `home_monitor`, so the operator names it.
 *
 * Required only when a MySQL client is in use. SQLite stores its whole database
 * in one file (`DB_FILE`) and has no schema name, which is why this is not part
 * of `loadConfig`'s schema — that would make every SQLite deployment set a
 * variable nothing reads.
 */
export function requiredDbName(): string {
  return required('DB_NAME', process.env.DB_NAME)
}

/**
 * A schema name that is obviously a scratch database.
 *
 * The perf harness refuses to write hundreds of thousands of rows into a schema
 * unless the name says it is disposable (`scripts/perfDataset.ts`). This is the
 * list of names that are too close to a real one to trust, kept beside the
 * naming rules so the guard and the docs cannot drift.
 *
 * These are *rejected* names, not defaults — nothing here is ever assigned to a
 * database.
 */
export const RESERVED_DB_NAMES = ['home_monitor', 'smart_home_monitor', 'monitor']
