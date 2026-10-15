/**
 * Dev/seed data: 12 devices, 7 days of bandwidth, connection events,
 * one admin user and 3 alert rules. Safe to re-run: it refuses to seed
 * a database that already has devices.
*
 * Byte counters are written as strings and stay below 2^63 so both
 * dialects store them exactly (AUDIT.md A-05).
*
 * ## API
 * 
 * This script seeds the smart network monitoring database with synthetic
 * test data for development and testing. The following entities are created:
 * 
 * ### Devices
 * 12 devices with various types (phone, laptop, tv, speaker, printer, camera, server, tablet, thermostat, game console, switch, network switch) across categories (Personal, Entertainment, Smart Home).
 * 
 * ### Bandwidth Metrics
 * 12 devices × 7 days × 14 hours/day × 2 samples/hour = ~4,032 rows of cumulative upload/download byte counters.
 * Each device gets randomized upload/download speeds simulating typical network usage.
 * 
 * ### Connection Logs
 * For each device, 3 days of connection/disconnection events (connect + disconnect pairs).
 * 
 * ### Users
 * One platform admin user (admin@network-monitor.local) with a hashed password.
 * 
 * ### Alerts
 * Three alert rules: bandwidth exceeded (50 MB threshold) and device offline detection.
 * 
 * ### PayStack Integration
 * PayStack billing integration is configured through the dashboard settings.
 * The following PayStack fields are available in the settings:
 * - `paystackApiUrl` - Base URL for PayStack API
 * - `paystackSecret` - Secret key for PayStack API authentication
 * - `paystackAccessToken` - Access token for authenticated API calls
 * - `paystackSubscriptionId` - Subscription identifier for the PayStack plan
 * 
 * ### Data Schema
 * 
 * - **devices**: id, mac, ip, hostname, name, type, manufacturer, signalStrength, categoryId
 * - **bandwidth_metrics**: id, device_id, timestamp, upload_speed, download_speed, upload_total, download_total, created_at
 * - **connection_logs**: id, device_id, event_type, timestamp, ip_address, connection_duration, created_at
 * - **users**: id, email, password_hash, name, role, is_active, created_at, updated_at
 * - **device_alerts**: id, user_id, device_id, alert_type, threshold, is_active, created_at, updated_at
 * - **settings**: id, userId, scanIntervalSeconds, dataRetentionDays, networkSubnet, ignoreSubnets, notifyNewDevices, notifyDeviceOffline, notifyHighBandwidth, bandwidthThreshold, theme, paystackApiUrl, paystackSecret, paystackAccessToken, paystackSubscriptionId
 */