-- ============================================================================
-- NextLink ISP — Phase 3 schema (Billing, MikroTik, Payment Gateway, SMS)
-- ----------------------------------------------------------------------------
-- DESIGN RULE: This script is ADDITIVE ONLY.
--   * Every statement is CREATE ... IF NOT EXISTS — safe to re-run.
--   * Existing tables (packages, subscribers, invoices, tickets, technicians,
--     admin_users, roles, app_settings, orders) are NEVER dropped or altered.
--   * Reason: backend/src/lib/db.ts -> saveAdminSection() rewrites legacy
--     tables with DELETE FROM + re-INSERT, so adding columns to those tables
--     would silently lose data on the next admin save. All new state therefore
--     lives in dedicated tables below, plus `raw_data` JSONB on `invoices`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Per-subscriber recurring billing profile
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriber_billing (
  subscriber_id        VARCHAR(100) PRIMARY KEY,
  package_id           VARCHAR(100),
  amount               NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency             VARCHAR(10)  NOT NULL DEFAULT 'BDT',
  billing_start        DATE,
  billing_end          DATE,
  next_invoice_date    DATE,
  auto_disconnect      BOOLEAN      NOT NULL DEFAULT TRUE,
  status               VARCHAR(30)  NOT NULL DEFAULT 'active',
  last_invoice_id      VARCHAR(100),
  raw_data             JSONB,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Monthly billing cycle runs (one row per period, e.g. 2026-11)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_cycles (
  id                  VARCHAR(64) PRIMARY KEY,
  period              VARCHAR(20) NOT NULL UNIQUE,
  status              VARCHAR(30) NOT NULL DEFAULT 'running',
  invoice_count       INTEGER NOT NULL DEFAULT 0,
  total_amount        NUMERIC(14,2) NOT NULL DEFAULT 0,
  collected_amount    NUMERIC(14,2) NOT NULL DEFAULT 0,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ,
  details             JSONB
);

-- ---------------------------------------------------------------------------
-- Gateway payment transactions (one row per payment attempt)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_transactions (
  id                  VARCHAR(64) PRIMARY KEY,
  invoice_id          VARCHAR(100),
  subscriber_id       VARCHAR(100),
  gateway             VARCHAR(30)  NOT NULL,
  amount              NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency            VARCHAR(10)  NOT NULL DEFAULT 'BDT',
  status              VARCHAR(30)  NOT NULL DEFAULT 'pending',
  gateway_txn_id      VARCHAR(120),
  reference           VARCHAR(120),
  method              VARCHAR(40),
  raw_data            JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Raw inbound webhook payloads (audit + replay safety)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_webhooks (
  id                  BIGSERIAL PRIMARY KEY,
  gateway             VARCHAR(30)  NOT NULL,
  event_type          VARCHAR(80),
  gateway_txn_id      VARCHAR(120),
  payload             JSONB,
  status              VARCHAR(30)  NOT NULL DEFAULT 'received',
  error               TEXT,
  processed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Billing event trail (invoice generated, reminder sent, suspended, reconnected)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_events (
  id                  BIGSERIAL PRIMARY KEY,
  subscriber_id       VARCHAR(100),
  invoice_id          VARCHAR(100),
  event               VARCHAR(60) NOT NULL,
  amount              NUMERIC(12,2),
  message             TEXT,
  raw_data            JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- MikroTik router operation log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mikrotik_sync_log (
  id                  BIGSERIAL PRIMARY KEY,
  subscriber_id       VARCHAR(100),
  router              VARCHAR(120),
  action              VARCHAR(60) NOT NULL,
  status              VARCHAR(30) NOT NULL DEFAULT 'pending',
  request             JSONB,
  response            JSONB,
  error               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Outbound SMS log (bill reminders, ticket updates, maintenance notices)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sms_messages (
  id                  BIGSERIAL PRIMARY KEY,
  subscriber_id       VARCHAR(100),
  phone               VARCHAR(30),
  body                TEXT NOT NULL,
  template            VARCHAR(60),
  status              VARCHAR(30) NOT NULL DEFAULT 'queued',
  provider            VARCHAR(30),
  provider_message_id VARCHAR(120),
  error               TEXT,
  sent_at             TIMESTAMPTZ,
  raw_data            JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Generic audit log (who did what, when)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id                  BIGSERIAL PRIMARY KEY,
  actor_id            VARCHAR(100),
  actor_role          VARCHAR(50),
  action              VARCHAR(80) NOT NULL,
  entity_type         VARCHAR(60),
  entity_id           VARCHAR(120),
  details             JSONB,
  ip_address          VARCHAR(60),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- API staff accounts (hashed credentials — replaces hardcoded staff logins)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_users (
  id                  VARCHAR(64) PRIMARY KEY,
  email               VARCHAR(160) NOT NULL UNIQUE,
  password_hash       TEXT NOT NULL,
  name                VARCHAR(160),
  role                VARCHAR(50) NOT NULL DEFAULT 'support',
  status              VARCHAR(30) NOT NULL DEFAULT 'active',
  last_login_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Online connection requests (public website booking form)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connection_requests (
  id                  VARCHAR(64) PRIMARY KEY,
  full_name           VARCHAR(255) NOT NULL,
  phone               VARCHAR(60),
  email               VARCHAR(255),
  id_number           VARCHAR(120),
  id_document_path    VARCHAR(500),
  address             TEXT,
  package_id          VARCHAR(100),
  package_name        VARCHAR(255),
  ont_config          VARCHAR(120),
  referral            VARCHAR(120),
  status              VARCHAR(30) NOT NULL DEFAULT 'pending',
  subscriber_id       VARCHAR(100),
  raw_data            JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Coverage areas (public website location checker)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coverage_areas (
  id                  VARCHAR(64) PRIMARY KEY,
  zone                VARCHAR(120) NOT NULL,
  district            VARCHAR(120),
  areas               TEXT[],
  status              VARCHAR(30) NOT NULL DEFAULT 'available',
  lat                 NUMERIC(10,7),
  lng                 NUMERIC(10,7),
  notes               TEXT,
  raw_data            JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Support tickets (CRM) — extends the legacy `tickets` table with the
-- lifecycle fields the SRS requires (assignment, SLA, resolution).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_details (
  ticket_id           VARCHAR(100) PRIMARY KEY,
  subscriber_id       VARCHAR(100),
  category            VARCHAR(60),
  description         TEXT,
  assigned_to         VARCHAR(100),
  assigned_to_name    VARCHAR(160),
  sla_due_at          TIMESTAMPTZ,
  first_response_at   TIMESTAMPTZ,
  resolved_at         TIMESTAMPTZ,
  closed_at           TIMESTAMPTZ,
  raw_data            JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Ticket message thread (subscriber <-> helpdesk conversation)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_messages (
  id                  BIGSERIAL PRIMARY KEY,
  ticket_id           VARCHAR(100) NOT NULL,
  author_type         VARCHAR(20) NOT NULL DEFAULT 'subscriber',
  author_id           VARCHAR(100),
  author_name         VARCHAR(160),
  body                TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- System settings for the core infrastructure (MikroTik, SMS, gateways)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_settings (
  key                 VARCHAR(100) PRIMARY KEY,
  value               JSONB NOT NULL,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Subscriber credentials (hashed).
--
-- Kept in its own table on purpose: the legacy `subscribers` table is
-- rewritten with DELETE FROM + re-INSERT by the admin store, so a password
-- column added there would be lost on the next admin save.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriber_credentials (
  subscriber_id       VARCHAR(100) PRIMARY KEY,
  username            VARCHAR(120),
  password_hash       TEXT NOT NULL,
  legacy_password     TEXT,
  migrated_at         TIMESTAMPTZ,
  last_login_at       TIMESTAMPTZ,
  raw_data            JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- RouterOS profile for each package
--
-- Without this a subscriber on a gigabit plan is shaped at the 10 Mbps
-- fallback profile.
-- ---------------------------------------------------------------------------
ALTER TABLE packages ADD COLUMN IF NOT EXISTS routeros_profile VARCHAR(100);
ALTER TABLE packages ADD COLUMN IF NOT EXISTS max_limit VARCHAR(50);

-- ---------------------------------------------------------------------------
-- Indexes (IF NOT EXISTS keeps re-runs safe)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_subscriber_billing_next_invoice ON subscriber_billing (next_invoice_date);
CREATE INDEX IF NOT EXISTS idx_subscriber_billing_status       ON subscriber_billing (status);

CREATE INDEX IF NOT EXISTS idx_payment_txn_invoice    ON payment_transactions (invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_txn_subscriber ON payment_transactions (subscriber_id);
CREATE INDEX IF NOT EXISTS idx_payment_txn_status     ON payment_transactions (status);
CREATE INDEX IF NOT EXISTS idx_payment_txn_gateway_id ON payment_transactions (gateway, gateway_txn_id);

CREATE INDEX IF NOT EXISTS idx_payment_webhooks_gateway ON payment_webhooks (gateway);
CREATE INDEX IF NOT EXISTS idx_payment_webhooks_txn     ON payment_webhooks (gateway_txn_id);

CREATE INDEX IF NOT EXISTS idx_billing_events_subscriber ON billing_events (subscriber_id);
CREATE INDEX IF NOT EXISTS idx_billing_events_invoice    ON billing_events (invoice_id);

CREATE INDEX IF NOT EXISTS idx_mikrotik_log_subscriber ON mikrotik_sync_log (subscriber_id);

CREATE INDEX IF NOT EXISTS idx_sms_messages_subscriber ON sms_messages (subscriber_id);
CREATE INDEX IF NOT EXISTS idx_sms_messages_status     ON sms_messages (status);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor   ON audit_log (actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity  ON audit_log (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_connection_requests_status ON connection_requests (status);
CREATE INDEX IF NOT EXISTS idx_connection_requests_phone  ON connection_requests (phone);

CREATE INDEX IF NOT EXISTS idx_coverage_areas_zone     ON coverage_areas (zone);
CREATE INDEX IF NOT EXISTS idx_coverage_areas_district ON coverage_areas (district);

CREATE INDEX IF NOT EXISTS idx_ticket_details_subscriber ON ticket_details (subscriber_id);
CREATE INDEX IF NOT EXISTS idx_ticket_details_assigned  ON ticket_details (assigned_to);
CREATE INDEX IF NOT EXISTS idx_ticket_details_sla       ON ticket_details (sla_due_at);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON ticket_messages (ticket_id);

CREATE INDEX IF NOT EXISTS idx_subscriber_credentials_username ON subscriber_credentials (username);
