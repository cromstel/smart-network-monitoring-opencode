# -*- coding: utf-8 -*-
p = 'lib/services/rollupJob.ts'
s = open(p, encoding='utf-8').read()
s = s.replace(""" * Two dialect differences are handled explicitly:
 *   - truncating a timestamp to the hour (`DATE_FORMAT` vs `strftime`),
 *   - summing a byte counter that is stored as TEXT. `CAST(... AS UNSIGNED)`
 *     is MySQL-only and `CAST(... AS INTEGER)` is SQLite-only, so the cast is
 *     chosen from `DB_CLIENT` rather than assumed.""",
""" * Two dialect differences are handled explicitly:
 *   - truncating a timestamp to the hour (`DATE_FORMAT` vs `strftime`),
 *   - summing a byte counter that is stored as TEXT. `CAST(... AS UNSIGNED)`
 *     is the only cast that does not wrap at 2^31, so it is used unconditionally.""")
s = s.replace(""" * This used to be `DATE_FORMAT(col, '%Y-%m-%d %H:00:00')` on MySQL and
 * `strftime(...)` on SQLite, which assumed the column held a real DATETIME.""",
""" * This used to be `DATE_FORMAT(col, '%Y-%m-%d %H:00:00')`, which assumed
 * the column held a real DATETIME.""")
s = s.replace(""" * A fresh UUID **per output row**, per dialect.
 *""",
""" * A fresh UUID **per output row**.
 *""")
s = s.replace(""" * The SQLite form builds the canonical 8-4-4-4-12 hex shape from randomblob;
 * `hex()` emits uppercase, hence the outer `lower()`.
 */""", """ */""")
s = s.replace("""  // Re-running for an hour already aggregated must update, not duplicate.
  //
  // Both the clause and the "value that would have been inserted" reference are
  // dialect-specific:
  //   SQLite: on conflict (cols) do update set col = excluded.col
  //   MySQL:  on duplicate key update col = values(col)
  // MySQL has no `excluded` pseudo-table; `values(col)` is its equivalent and is
  // accepted by MariaDB and MySQL 5.7/8.0 alike. Re-aggregating an hour is the
  // normal case after a restart, so this path runs for real, not just at edges.""",
"""  // Re-running for an hour already aggregated must update, not duplicate.
  //
  // MySQL has no `excluded` pseudo-table; `values(col)` is its equivalent and
  // is accepted by MariaDB and MySQL 5.7/8.0 alike. Re-aggregating an hour is
  // the normal case after a restart, so this path runs for real, not just at
  // edges.""")
open(p, 'w', encoding='utf-8').write(s)
print('rollupJob comments cleaned')

p = 'lib/db/repositories/deviceRepository.ts'
s = open(p, encoding='utf-8').read()
s = s.replace("""and case-insensitive on SQLite's default
 *    `BINARY` collation only by accident of ASCII.""",
"""and users type `nas`, `NAS` and `Nas` interchangeably and expect
 *    the same three results regardless of the server's collation.""")
s = s.replace("""  // `ESCAPE '\\\\'` looks like a no-op and is easy to get wrong in a JS template
  // literal, where the doubling rules differ from SQL's. SQLite rejects
  // anything that is not exactly one character, so a mis-escaped clause fails
  // loudly rather than silently \u2014 which is better, but still a trap.""",
"""  // `ESCAPE '\\\\'` looks like a no-op and is easy to get wrong in a JS template
  // literal, where the doubling rules differ from SQL's. The server rejects
  // anything that is not exactly one character, so a mis-escaped clause fails
  // loudly rather than silently \u2014 which is better, but still a trap.""")
open(p, 'w', encoding='utf-8').write(s)
print('deviceRepository comments cleaned')
