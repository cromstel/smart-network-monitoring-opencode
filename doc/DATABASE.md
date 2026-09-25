# Database Schema

MySQL 8.0+ in production, SQLite in development. Every statement must work on both.

Conventions: `CHAR(36)` UUIDv4 primary keys generated in application code · `snake_case` columns · UTC ISO-8601 timestamps · `TINYINT(1)`/`INTEGER` booleans normalised at the repository edge · `BIGINT` byte counters read as `string`.

---

## Tables

### `devices`
```sql
CREATE TABLE devices (
  id                    CHAR(36)     NOT NULL PRIMARY KEY,
  mac_address           VARCHAR(17)  NOT NULL,           -- uppercase, colon-separated
  ip_address            VARCHAR(45)  NOT NULL,           -- 45 = max IPv6
  hostname              VARCHAR(255) NULL,
  device_name           VARCHAR(255) NULL,               -- user-set
  device_type           VARCHAR(50)  NOT NULL DEFAULT 'unknown',
  manufacturer          VARCHAR(255) NULL,               -- from OUI
  signal_strength       INT          NULL,               -- dBm
  status                VARCHAR(20)  NOT NULL DEFAULT 'offline',
  is_blocked            TINYINT(1)   NOT NULL DEFAULT 0,
  is_ignored            TINYINT(1)   NOT NULL DEFAULT 0,
  total_connection_time BIGINT       NOT NULL DEFAULT 0, -- seconds
  category_id           CHAR(36)     NULL,
  first_seen            DATETIME(3)  NOT NULL,
  last_seen             DATETIME(3)  NOT NULL,
  created_at            DATETIME(3)  NOT NULL,
  updated_at            DATETIME(3)  NOT NULL,
  UNIQUE KEY uq_devices_mac (mac_address),
  KEY idx_devices_status (status),
  KEY idx_devices_last_seen (last_seen),
  KEY idx_devices_category (category_id),
  CONSTRAINT fk_devices_category FOREIGN KEY (category_id)
    REFERENCES device_categories(id) ON DELETE SET NULL
);
```
`mac_address` is the natural key — IP addresses change with DHCP, MAC addresses do not. Uppercase at write (`IMPLEMENTATION.md` §5).

### `bandwidth_metrics`
The largest table. One row per device per sample.
```sql
CREATE TABLE bandwidth_metrics (
  id             CHAR(36)    NOT NULL PRIMARY KEY,
  device_id      CHAR(36)    NOT NULL,
  timestamp      DATETIME(3) NOT NULL,
  upload_speed   DOUBLE      NOT NULL DEFAULT 0,  -- Mbps, instantaneous
  download_speed DOUBLE      NOT NULL DEFAULT 0,
  upload_total   BIGINT      NOT NULL DEFAULT 0,  -- bytes, cumulative
  download_total BIGINT      NOT NULL DEFAULT 0,
  created_at     DATETIME(3) NOT NULL,
  KEY idx_bm_device_time (device_id, timestamp),  -- carries every history query
  KEY idx_bm_timestamp (timestamp),               -- carries retention pruning
  CONSTRAINT fk_bm_device FOREIGN KEY (device_id)
    REFERENCES devices(id) ON DELETE CASCADE
);
```
At a 10s interval and 10 devices this grows ~2.6M rows/month. Retention pruning (`TODO.md` B-24) is mandatory, not optional.

`upload_total`/`download_total` are `BIGINT` and must never reach a JSON response as a JS `bigint` — see `AUDIT.md` A-05.

### `bandwidth_hourly`
Rollup written nightly. History beyond 24h reads this, not raw rows. This is what keeps the 30-day query under the 1s target.
```sql
CREATE TABLE bandwidth_hourly (
  id                 CHAR(36)    NOT NULL PRIMARY KEY,
  device_id          CHAR(36)    NOT NULL,
  hour_start         DATETIME(3) NOT NULL,
  avg_upload_speed   DOUBLE      NOT NULL DEFAULT 0,
  avg_download_speed DOUBLE      NOT NULL DEFAULT 0,
  peak_upload_speed  DOUBLE      NOT NULL DEFAULT 0,
  peak_download_speed DOUBLE     NOT NULL DEFAULT 0,
  bytes_uploaded     BIGINT      NOT NULL DEFAULT 0,
  bytes_downloaded   BIGINT      NOT NULL DEFAULT 0,
  sample_count       INT         NOT NULL DEFAULT 0,
  created_at         DATETIME(3) NOT NULL,
  UNIQUE KEY uq_bh_device_hour (device_id, hour_start),  -- makes the rollup idempotent
  CONSTRAINT fk_bh_device FOREIGN KEY (device_id)
    REFERENCES devices(id) ON DELETE CASCADE
);
```
The unique key is why running the rollup twice cannot double-count.

### `connection_logs`
```sql
CREATE TABLE connection_logs (
  id                  CHAR(36)    NOT NULL PRIMARY KEY,
  device_id           CHAR(36)    NOT NULL,
  event_type          VARCHAR(20) NOT NULL,  -- 'connected' | 'disconnected'
  timestamp           DATETIME(3) NOT NULL,
  ip_address          VARCHAR(45) NULL,
  connection_duration INT         NULL,      -- seconds; set on disconnect
  created_at          DATETIME(3) NOT NULL,
  KEY idx_cl_device_time (device_id, timestamp),
  KEY idx_cl_event (event_type),
  CONSTRAINT fk_cl_device FOREIGN KEY (device_id)
    REFERENCES devices(id) ON DELETE CASCADE
);
```

### `device_categories`
```sql
CREATE TABLE device_categories (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  color       VARCHAR(7)   NOT NULL DEFAULT '#3b82f6',
  icon        VARCHAR(50)  NULL,
  description TEXT         NULL,
  created_at  DATETIME(3)  NOT NULL,
  updated_at  DATETIME(3)  NOT NULL,
  UNIQUE KEY uq_dc_name (name)
);
```

### `users`
```sql
CREATE TABLE users (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  email         VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,   -- bcrypt, cost >= 12
  name          VARCHAR(255) NULL,
  role          VARCHAR(20)  NOT NULL DEFAULT 'VIEWER',  -- ADMIN | MEMBER | VIEWER
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  last_login_at DATETIME(3)  NULL,
  created_at    DATETIME(3)  NOT NULL,
  updated_at    DATETIME(3)  NOT NULL,
  UNIQUE KEY uq_users_email (email)
);
```
`password_hash` never leaves the repository layer. No DTO includes it.

### `sessions`
```sql
CREATE TABLE sessions (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  user_id    CHAR(36)     NOT NULL,
  token_hash VARCHAR(255) NOT NULL,   -- SHA-256 of the cookie value, never the value
  expires_at DATETIME(3)  NOT NULL,
  ip_address VARCHAR(45)  NULL,
  user_agent VARCHAR(512) NULL,
  created_at DATETIME(3)  NOT NULL,
  UNIQUE KEY uq_sessions_token (token_hash),
  KEY idx_sessions_user (user_id),
  KEY idx_sessions_expires (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE
);
```
The raw token exists only in the cookie. A database read cannot recover it.

### `user_settings`
```sql
CREATE TABLE user_settings (
  id                    CHAR(36)     NOT NULL PRIMARY KEY,
  user_id               CHAR(36)     NOT NULL,
  scan_interval_seconds INT          NOT NULL DEFAULT 30,
  data_retention_days   INT          NOT NULL DEFAULT 30,
  network_subnet        VARCHAR(64)  NOT NULL DEFAULT '192.168.1.0/24',
  ignore_subnets        TEXT         NULL,
  notify_new_devices    TINYINT(1)   NOT NULL DEFAULT 1,
  notify_device_offline TINYINT(1)   NOT NULL DEFAULT 1,
  notify_high_bandwidth TINYINT(1)   NOT NULL DEFAULT 0,
  bandwidth_threshold   DOUBLE       NOT NULL DEFAULT 100,
  theme                 VARCHAR(10)  NOT NULL DEFAULT 'dark',
  created_at            DATETIME(3)  NOT NULL,
  updated_at            DATETIME(3)  NOT NULL,
  UNIQUE KEY uq_us_user (user_id),
  CONSTRAINT fk_us_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE
);
```

### `device_alerts`
Alert **rules**, owned by a user.
```sql
CREATE TABLE device_alerts (
  id             CHAR(36)    NOT NULL PRIMARY KEY,
  user_id        CHAR(36)    NOT NULL,   -- owner; see PRD F-34
  device_id      CHAR(36)    NULL,       -- NULL = applies to all devices
  alert_type     VARCHAR(50) NOT NULL,   -- unknown_device | bandwidth_exceeded | device_offline
  threshold      DOUBLE      NULL,
  is_active      TINYINT(1)  NOT NULL DEFAULT 1,
  last_triggered DATETIME(3) NULL,
  trigger_count  INT         NOT NULL DEFAULT 0,
  created_at     DATETIME(3) NOT NULL,
  updated_at     DATETIME(3) NOT NULL,
  KEY idx_da_user (user_id),
  KEY idx_da_device (device_id),
  CONSTRAINT fk_da_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_da_device FOREIGN KEY (device_id)
    REFERENCES devices(id) ON DELETE CASCADE
);
```
**`user_id` is not optional and is not decorative.** Every query against this table filters by it. A prior related project shipped a bug where one user's bandwidth threshold fired notifications for every user. `TODO.md` B-51 requires the negative test be written before the feature.

### `notifications`
Alert **instances**, delivered to a user.
```sql
CREATE TABLE notifications (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  user_id    CHAR(36)     NOT NULL,
  device_id  CHAR(36)     NULL,
  alert_id   CHAR(36)     NULL,
  title      VARCHAR(255) NOT NULL,
  message    TEXT         NOT NULL,
  type       VARCHAR(20)  NOT NULL DEFAULT 'info',    -- info|success|warning|error
  priority   VARCHAR(10)  NOT NULL DEFAULT 'medium',
  is_read    TINYINT(1)   NOT NULL DEFAULT 0,
  read_at    DATETIME(3)  NULL,
  data       TEXT         NULL,                        -- JSON
  created_at DATETIME(3)  NOT NULL,
  KEY idx_n_user_read (user_id, is_read),
  KEY idx_n_created (created_at),
  CONSTRAINT fk_n_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_n_device FOREIGN KEY (device_id)
    REFERENCES devices(id) ON DELETE SET NULL
);
```

### `router_config`
```sql
CREATE TABLE router_config (
  id                  CHAR(36)     NOT NULL PRIMARY KEY,
  router_type         VARCHAR(50)  NOT NULL,   -- asus | tplink | netgear | generic
  router_name         VARCHAR(255) NULL,
  router_ip           VARCHAR(45)  NOT NULL,
  port                INT          NOT NULL DEFAULT 80,
  username            VARCHAR(255) NOT NULL,
  password_encrypted  TEXT         NOT NULL,   -- AES-256-GCM: iv:authTag:ciphertext
  mac_address         VARCHAR(17)  NULL,
  model_number        VARCHAR(100) NULL,
  firmware_version    VARCHAR(100) NULL,
  is_connected        TINYINT(1)   NOT NULL DEFAULT 0,
  last_check_at       DATETIME(3)  NULL,
  last_success_at     DATETIME(3)  NULL,
  created_at          DATETIME(3)  NOT NULL,
  updated_at          DATETIME(3)  NOT NULL,
  UNIQUE KEY uq_rc_ip (router_ip)
);
```
The column is named `password_encrypted`, not `password`, so that a plaintext write is visibly wrong at the call site (`AUDIT.md` A-09).

### `network_metrics` and `network_scan_history`
```sql
CREATE TABLE network_metrics (
  id                   CHAR(36)    NOT NULL PRIMARY KEY,
  timestamp            DATETIME(3) NOT NULL,
  total_bandwidth_up   DOUBLE      NOT NULL DEFAULT 0,
  total_bandwidth_down DOUBLE      NOT NULL DEFAULT 0,
  active_devices       INT         NOT NULL DEFAULT 0,
  online_devices       INT         NOT NULL DEFAULT 0,
  peak_bandwidth_up    DOUBLE      NOT NULL DEFAULT 0,
  peak_bandwidth_down  DOUBLE      NOT NULL DEFAULT 0,
  created_at           DATETIME(3) NOT NULL,
  KEY idx_nm_timestamp (timestamp)
);

CREATE TABLE network_scan_history (
  id             CHAR(36)    NOT NULL PRIMARY KEY,
  scanner_name   VARCHAR(20) NOT NULL,   -- simulated | arp | asus
  scan_duration  INT         NOT NULL,   -- ms
  device_count   INT         NOT NULL DEFAULT 0,
  success_count  INT         NOT NULL DEFAULT 0,
  failure_count  INT         NOT NULL DEFAULT 0,
  status         VARCHAR(20) NOT NULL,   -- success | partial | failed
  error_message  TEXT        NULL,
  created_at     DATETIME(3) NOT NULL,
  KEY idx_nsh_created (created_at)
);
```

---

## Dialect translation

The migrator emits the correct variant per dialect. What changes:

| MySQL | SQLite |
|---|---|
| `CHAR(36)`, `VARCHAR(n)`, `TEXT` | `TEXT` |
| `INT`, `BIGINT`, `TINYINT(1)` | `INTEGER` |
| `DOUBLE` | `REAL` |
| `DATETIME(3)` | `TEXT` (ISO-8601 UTC) |
| `ON UPDATE CURRENT_TIMESTAMP` | not supported — set in application code |
| `ON DUPLICATE KEY UPDATE` | `ON CONFLICT ... DO UPDATE` |
| FKs enforced by default | requires `PRAGMA foreign_keys = ON` per connection |

That last row is a real trap: SQLite silently ignores foreign keys unless the pragma is set on every connection. Set it in `lib/db/client.ts` when the SQLite dialect is selected, or cascade deletes will not happen in development and will happen in production.

---

## Retention

Nightly, per `user_settings.data_retention_days`:

1. Roll `bandwidth_metrics` older than 24h into `bandwidth_hourly`.
2. Delete `bandwidth_metrics` older than the retention window.
3. Delete `connection_logs` and `notifications` older than the window.
4. Delete `network_scan_history` older than 7 days.
5. Delete `sessions` past `expires_at`.

Delete in batches of ~10,000 with a short pause between. A single unbounded `DELETE` over millions of rows will lock the table and stall the scanner.
