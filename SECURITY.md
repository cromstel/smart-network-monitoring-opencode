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

## Required Configuration

There are no built-in credentials, keys or identity values, in any environment —
including development. Every value below must be supplied, and the process
refuses to start without it.

| Variable | Required | Notes |
| --- | --- | --- |
| `SESSION_SECRET` | always | 32+ characters. Keys the HMAC-SHA256 under which session-token hashes are stored (`lib/utils/crypto.ts`); rotating it invalidates every session. |
| `ENCRYPTION_KEY` | always | 32+ characters. Encrypts stored router credentials. |
| `APP_NAME` | always | Shown in the browser tab, sidebar and sign-in page. |
| `DB_NAME` | when `DB_CLIENT=mysql` | The schema to connect to. |
| `DB_USER` | when `DB_CLIENT=mysql` | The account to connect as. |
| `DB_PASSWORD` | when `DB_CLIENT=mysql` | Never defaulted to a usable value. |

Generate the two keys with `openssl rand -hex 32`. `lib/config.ts` validates all
of them at boot and reports every missing or weak value in one message.

An earlier version substituted literal `dev-only-insecure-*` defaults whenever a
secret was absent outside production, and defaulted the schema and user name to
`home_monitor` / `monitor`. Both are removed:

- a **usable default for a secret is a published key**, shared by every clone of
  this repository and every CI run that used it;
- a **default schema or user name** lets a deployment that forgot to configure
  one silently connect to whichever database and account happen to exist under
  that name — a wrong-database bug that looks like a working connection.

Because a default enforced only in production still allows a weak value to
travel from a developer's machine to staging to the production host, the
presence and length checks apply in **every** environment. The failure is raised
where the placeholder was written, not at the deploy that inherits it.

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
