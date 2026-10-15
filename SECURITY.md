# Security Guidelines

## Overview

This document outlines the security requirements for the Smart Network
Monitoring application, and how to report a vulnerability in it.

## Reporting a Vulnerability

Report suspected vulnerabilities privately — open an issue only after a fix is
available. GitHub private vulnerability reporting is enabled on this repository;
use the **Report a vulnerability** button on the Security tab rather than a
public issue, a pull request, or a discussion.

Expect an acknowledgement within 72 hours and a severity assessment within 7
days. Fixes are prioritised by impact: anything allowing authentication bypass,
privilege escalation, or credential disclosure is treated as critical and
worked immediately.

## Supported Versions

Only the latest released version receives security updates. Upgrade as soon as
a new version is available rather than waiting for a maintenance window.

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

## Authentication & Authorization

- All API endpoints require JWT-based authentication
- Admin users have elevated privileges for system configuration
- Session tokens expire after 24 hours of inactivity
- Role-based access control (RBAC) restricts feature access

## Data Protection

- Sensitive data (API keys, secrets) must be stored securely
- Database connections use encrypted transport (TLS 1.3)
- Personal data is anonymized before logging
- Regular security audits are conducted monthly

## API Security

- Rate limiting applied to all endpoints (100 requests/minute per IP)
- Input validation and sanitization for all user inputs
- CORS policies restrict allowed origins
- Secrets are never logged or exposed in responses

## PayStack Integration

- PayStack API credentials are stored in environment variables only
- Secret keys are rotated quarterly
- Transaction amounts are validated against business limits
- Refund and charge operations require manual approval for amounts > $100

### Credentials are write-only

The PayStack secret and access token are never returned by `GET /api/settings`.
The response carries `paystackSecretSet` and `paystackAccessTokenSet` booleans
instead, so the dashboard can show whether a value is configured without the
value ever reaching the browser. This follows the same allow-listed projection
already used for the router password in `app/api/router-config/route.ts`.

The settings form exploits this: a blank credential input means "keep the stored
value", never "clear it". Only fields the operator actually types are sent, so
saving one field cannot overwrite another.

## Dashboard Settings

- Admin panel accessible only to users with ROLE_ADMIN
- Settings are persisted in the database with encryption at rest
- Changes are logged for audit trail
- Backup and recovery procedures are documented

## Compliance

- GDPR compliant data handling
- Regular penetration testing

## Reporting a Bug That Is Not a Security Issue

File a regular issue. Anything involving credentials, authentication, or
privilege boundaries should go through the private reporting path above instead.
