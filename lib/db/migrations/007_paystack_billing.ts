import type { Kysely } from 'kysely'
import type { DB } from '../schema'

/**
 * PayStack billing credentials (B-67).
 *
 * A separate migration rather than an edit to 005: `user_settings` already
 * exists in every deployed database, and Kysely will not re-run an applied
 * migration. Editing 005 would only affect fresh databases, leaving existing
 * rows permanently without the columns.
 *
 * NOT NULL + empty-string default, not NULL, deliberately. `UserSettings`
 * declares these four fields as non-optional `string`, so a null would push
 * `?? ''` into every read path and the dashboard would render `null` until
 * each one is filled in. An empty string says "not configured" in the same
 * dialect-neutral way the rest of this schema expresses defaults, and needs
 * no conversion on the way out.
 *
 * varchar(255) matches `network_subnet` (64) being generous enough for the
 * longest realistic token while staying well under both engines' index limits.
 */
export async function up(db: Kysely<DB>): Promise<void> {
  await db.schema
    .alterTable('user_settings')
    .addColumn('paystack_api_url', 'varchar(255)', (c) => c.notNull().defaultTo(''))
    .execute()
  await db.schema
    .alterTable('user_settings')
    .addColumn('paystack_secret', 'varchar(255)', (c) => c.notNull().defaultTo(''))
    .execute()
  await db.schema
    .alterTable('user_settings')
    .addColumn('paystack_access_token', 'varchar(255)', (c) => c.notNull().defaultTo(''))
    .execute()
  await db.schema
    .alterTable('user_settings')
    .addColumn('paystack_subscription_id', 'varchar(255)', (c) => c.notNull().defaultTo(''))
    .execute()
}

export async function down(db: Kysely<DB>): Promise<void> {
  await db.schema.alterTable('user_settings').dropColumn('paystack_subscription_id').execute()
  await db.schema.alterTable('user_settings').dropColumn('paystack_access_token').execute()
  await db.schema.alterTable('user_settings').dropColumn('paystack_secret').execute()
  await db.schema.alterTable('user_settings').dropColumn('paystack_api_url').execute()
}
