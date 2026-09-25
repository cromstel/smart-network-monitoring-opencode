import type { Generated } from 'kysely'

export type SqlBigInt = string | number

export interface DeviceCategoriesTable {
  id: string
  name: string
  color: string
  icon: string | null
  description: string | null
  created_at: string
  updated_at: string
}

export interface DevicesTable {
  id: string
  mac_address: string
  ip_address: string
  hostname: string | null
  device_name: string | null
  device_type: Generated<string>
  manufacturer: string | null
  signal_strength: number | null
  status: Generated<string>
  is_blocked: Generated<number>
  is_ignored: Generated<number>
  total_connection_time: Generated<SqlBigInt>
  category_id: string | null
  first_seen: string
  last_seen: string
  created_at: string
  updated_at: string
}

export interface BandwidthMetricsTable {
  id: string
  device_id: string
  timestamp: string
  upload_speed: Generated<number>
  download_speed: Generated<number>
  upload_total: Generated<SqlBigInt>
  download_total: Generated<SqlBigInt>
  created_at: string
}

export interface BandwidthHourlyTable {
  id: string
  device_id: string
  hour_start: string
  avg_upload_speed: Generated<number>
  avg_download_speed: Generated<number>
  peak_upload_speed: Generated<number>
  peak_download_speed: Generated<number>
  bytes_uploaded: Generated<SqlBigInt>
  bytes_downloaded: Generated<SqlBigInt>
  sample_count: Generated<number>
  created_at: string
}

export interface ConnectionLogsTable {
  id: string
  device_id: string
  event_type: string
  timestamp: string
  ip_address: string | null
  connection_duration: number | null
  created_at: string
}

export interface UsersTable {
  id: string
  email: string
  password_hash: string
  name: string | null
  role: Generated<string>
  is_active: Generated<number>
  last_login_at: string | null
  created_at: string
  updated_at: string
}

export interface SessionsTable {
  id: string
  user_id: string
  token_hash: string
  expires_at: string
  ip_address: string | null
  user_agent: string | null
  created_at: string
}

export interface DeviceAlertsTable {
  id: string
  user_id: string
  device_id: string | null
  alert_type: string
  threshold: number | null
  is_active: Generated<number>
  last_triggered: string | null
  trigger_count: Generated<number>
  created_at: string
  updated_at: string
}

export interface NotificationsTable {
  id: string
  user_id: string
  device_id: string | null
  alert_id: string | null
  title: string
  message: string
  type: Generated<string>
  priority: Generated<string>
  is_read: Generated<number>
  read_at: string | null
  data: string | null
  created_at: string
}

export interface UserSettingsTable {
  id: string
  user_id: string
  scan_interval_seconds: Generated<number>
  data_retention_days: Generated<number>
  network_subnet: Generated<string>
  ignore_subnets: string | null
  notify_new_devices: Generated<number>
  notify_device_offline: Generated<number>
  notify_high_bandwidth: Generated<number>
  bandwidth_threshold: Generated<number>
  theme: Generated<string>
  created_at: string
  updated_at: string
}

export interface RouterConfigTable {
  id: string
  router_type: string
  router_name: string | null
  router_ip: string
  port: Generated<number>
  username: string
  password_encrypted: string
  mac_address: string | null
  model_number: string | null
  firmware_version: string | null
  is_connected: Generated<number>
  last_check_at: string | null
  last_success_at: string | null
  created_at: string
  updated_at: string
}

export interface NetworkMetricsTable {
  id: string
  timestamp: string
  total_bandwidth_up: Generated<number>
  total_bandwidth_down: Generated<number>
  active_devices: Generated<number>
  online_devices: Generated<number>
  peak_bandwidth_up: Generated<number>
  peak_bandwidth_down: Generated<number>
  created_at: string
}

export interface NetworkScanHistoryTable {
  id: string
  scanner_name: string
  scan_duration: Generated<number>
  device_count: Generated<number>
  success_count: Generated<number>
  failure_count: Generated<number>
  status: string
  error_message: string | null
  created_at: string
}

export interface DB {
  device_categories: DeviceCategoriesTable
  devices: DevicesTable
  bandwidth_metrics: BandwidthMetricsTable
  bandwidth_hourly: BandwidthHourlyTable
  connection_logs: ConnectionLogsTable
  users: UsersTable
  sessions: SessionsTable
  device_alerts: DeviceAlertsTable
  notifications: NotificationsTable
  user_settings: UserSettingsTable
  router_config: RouterConfigTable
  network_metrics: NetworkMetricsTable
  network_scan_history: NetworkScanHistoryTable
}