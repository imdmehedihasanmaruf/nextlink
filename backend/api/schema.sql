-- ============================================================================
-- NextLink ISP — PostgreSQL Master Schema
-- ----------------------------------------------------------------------------
-- DESIGN RULE: This script is ADDITIVE ONLY and 100% IDEMPOTENT.
--   * Every statement is CREATE ... IF NOT EXISTS or ALTER ... ADD COLUMN IF NOT EXISTS.
--   * Safe to run on fresh databases as well as existing production deployments.
--   * Preserves all existing tables, foreign keys, constraints, and data.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Base Tables (Legacy & Core Store)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS packages (
  id                  VARCHAR(100) PRIMARY KEY,
  name                VARCHAR(255) NOT NULL,
  speed               INTEGER DEFAULT 50,
  upload_speed        INTEGER DEFAULT 50,
  price               NUMERIC(10, 2) DEFAULT 0,
  duration            INTEGER DEFAULT 30,
  description         TEXT,
  subscriber_count    INTEGER DEFAULT 0,
  features            TEXT[] DEFAULT '{}',
  bdix_speed          INTEGER DEFAULT 500,
  popular             BOOLEAN DEFAULT false,
  routeros_profile    VARCHAR(100),
  max_limit           VARCHAR(50),
  raw_data            JSONB,
  created_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subscribers (
  id                  VARCHAR(100) PRIMARY KEY,
  first_name          VARCHAR(120),
  last_name           VARCHAR(120),
  name                VARCHAR(255) NOT NULL,
  email               VARCHAR(255),
  phone               VARCHAR(100),
  package_id          VARCHAR(100),
  status              VARCHAR(50) DEFAULT 'active',
  theme               VARCHAR(20) DEFAULT 'system',
  raw_data            JSONB,
  created_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoices (
  id                  VARCHAR(100) PRIMARY KEY,
  subscriber_id       VARCHAR(100),
  amount              NUMERIC(10, 2) DEFAULT 0,
  installation_fee    NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  tax_fee             NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  late_fee            NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  carried_over_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  late_fee_applied    BOOLEAN NOT NULL DEFAULT FALSE,
  invoice_type        VARCHAR(50) DEFAULT 'subscription',
  status              VARCHAR(50) DEFAULT 'unpaid',
  due_date            VARCHAR(100),
  raw_data            JSONB,
  created_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tickets (
  id                  VARCHAR(100) PRIMARY KEY,
  title               TEXT,
  status              VARCHAR(50) DEFAULT 'open',
  priority            VARCHAR(50) DEFAULT 'medium',
  raw_data            JSONB,
  created_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS technicians (
  id                  VARCHAR(100) PRIMARY KEY,
  name                VARCHAR(255) NOT NULL,
  status              VARCHAR(50) DEFAULT 'active',
  raw_data            JSONB,
  created_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_users (
  id                  VARCHAR(100) PRIMARY KEY,
  name                VARCHAR(255) NOT NULL,
  email               VARCHAR(255),
  role                VARCHAR(100) DEFAULT 'admin',
  status              VARCHAR(50) DEFAULT 'active',
  raw_data            JSONB,
  created_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS roles (
  id                  VARCHAR(100) PRIMARY KEY,
  name                VARCHAR(255) NOT NULL,
  raw_data            JSONB,
  created_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_settings (
  key                 VARCHAR(100) PRIMARY KEY,
  value               JSONB NOT NULL,
  updated_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id                  VARCHAR(50) PRIMARY KEY,
  customer_id         VARCHAR(50) NOT NULL,
  customer_name       VARCHAR(150),
  connection_id       VARCHAR(100),
  package_id          VARCHAR(50) NOT NULL,
  package_name        VARCHAR(100) NOT NULL,
  purchase_type       VARCHAR(50) NOT NULL,
  current_package_id  VARCHAR(50),
  current_package_name VARCHAR(100),
  download_speed      INT DEFAULT 100,
  upload_speed        INT DEFAULT 100,
  monthly_price       NUMERIC(10,2) DEFAULT 0.00,
  prorated_adjustment NUMERIC(10,2) DEFAULT 0.00,
  installation_fee    NUMERIC(10,2) DEFAULT 0.00,
  taxes               NUMERIC(10,2) DEFAULT 0.00,
  discount            NUMERIC(10,2) DEFAULT 0.00,
  total_payable       NUMERIC(10,2) DEFAULT 0.00,
  payment_method      VARCHAR(50),
  payment_status      VARCHAR(50) DEFAULT 'Payment Pending',
  order_status        VARCHAR(50) DEFAULT 'Pending Activation',
  trx_id              VARCHAR(100),
  next_billing_date   VARCHAR(50),
  expected_activation_time VARCHAR(100),
  raw_data            JSONB,
  created_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cancellations (
  id                  VARCHAR(100) PRIMARY KEY,
  subscriber_id       VARCHAR(100) NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  package_id          VARCHAR(100),
  package_name        VARCHAR(255),
  cancel_invoice_id   VARCHAR(100),
  reason              VARCHAR(255) NOT NULL,
  description         TEXT NOT NULL,
  buy_again_date      VARCHAR(50),
  not_sure_buy_again  BOOLEAN DEFAULT FALSE,
  cancel_date         VARCHAR(20) NOT NULL,
  cancel_time         VARCHAR(20) NOT NULL,
  city                VARCHAR(100) DEFAULT 'Unknown',
  postal_code         VARCHAR(50) DEFAULT 'Unknown',
  state               VARCHAR(100) DEFAULT 'Unknown',
  country             VARCHAR(100) DEFAULT 'Unknown',
  client_ip           VARCHAR(100),
  timezone            VARCHAR(50) DEFAULT 'UTC',
  status              VARCHAR(50) DEFAULT 'Cancelled',
  effective_date      VARCHAR(50),
  outstanding_balance NUMERIC(12, 2) DEFAULT 0.00,
  raw_data            JSONB DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS network_devices (
  id                  VARCHAR(100) PRIMARY KEY,
  name                VARCHAR(255) NOT NULL,
  type                VARCHAR(100) NOT NULL,
  ip                  VARCHAR(100),
  location            VARCHAR(255),
  status              VARCHAR(50) DEFAULT 'online',
  raw_data            JSONB DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- Per-subscriber recurring billing profile
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriber_billing (
  subscriber_id        VARCHAR(100) PRIMARY KEY,
  package_id           VARCHAR(100),
  amount               NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency             VARCHAR(10)  NOT NULL DEFAULT 'USD',
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
  currency            VARCHAR(10)  NOT NULL DEFAULT 'USD',
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
  event_id            VARCHAR(100),
  provider            VARCHAR(50),
  gateway             VARCHAR(30)  NOT NULL,
  event_type          VARCHAR(80),
  transaction_reference VARCHAR(150),
  gateway_txn_id      VARCHAR(120),
  payload             JSONB,
  status              VARCHAR(30)  NOT NULL DEFAULT 'pending',
  attempt_count       INTEGER NOT NULL DEFAULT 1,
  last_error_category VARCHAR(80),
  error               TEXT,
  next_retry_at       TIMESTAMPTZ,
  received_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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
-- API staff accounts (hashed credentials)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_users (
  id                  VARCHAR(64) PRIMARY KEY,
  email               VARCHAR(160) NOT NULL UNIQUE,
  password_hash       TEXT NOT NULL,
  name                VARCHAR(160),
  role                VARCHAR(50) NOT NULL DEFAULT 'support',
  status              VARCHAR(30) NOT NULL DEFAULT 'active',
  last_login_at       TIMESTAMPTZ,
  previous_login_at   TIMESTAMPTZ,
  last_login_ip       VARCHAR(80),
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
-- Support tickets (CRM) — lifecycle fields (assignment, SLA, resolution)
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
-- Subscriber credentials (hashed)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriber_credentials (
  subscriber_id       VARCHAR(100) PRIMARY KEY,
  username            VARCHAR(120),
  password_hash       TEXT NOT NULL,
  legacy_password     TEXT,
  migrated_at         TIMESTAMPTZ,
  last_login_at       TIMESTAMPTZ,
  previous_login_at   TIMESTAMPTZ,
  last_login_ip       VARCHAR(80),
  raw_data            JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Referral program
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referral_codes (
  subscriber_id   VARCHAR(100) PRIMARY KEY,
  code            VARCHAR(40)  NOT NULL UNIQUE,
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referrals (
  id                      VARCHAR(64)  PRIMARY KEY,
  referrer_id             VARCHAR(100) NOT NULL,
  referred_subscriber_id  VARCHAR(100),
  application_id          VARCHAR(64),
  code                    VARCHAR(40)  NOT NULL,
  status                  VARCHAR(30)  NOT NULL DEFAULT 'pending',
  reward_amount           NUMERIC(12,2) NOT NULL DEFAULT 0,
  qualified_at            TIMESTAMPTZ,
  credited_at             TIMESTAMPTZ,
  notes                   TEXT,
  raw_data                JSONB,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT referrals_application_unique UNIQUE (application_id),
  CONSTRAINT referrals_referred_unique    UNIQUE (referred_subscriber_id)
);

CREATE TABLE IF NOT EXISTS referral_rewards (
  id              VARCHAR(64)  PRIMARY KEY,
  referral_id     VARCHAR(64)  NOT NULL REFERENCES referrals(id) ON DELETE CASCADE,
  subscriber_id   VARCHAR(100) NOT NULL,
  amount          NUMERIC(12,2) NOT NULL,
  status          VARCHAR(30)  NOT NULL DEFAULT 'pending',
  credited_at     TIMESTAMPTZ,
  raw_data        JSONB,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT referral_rewards_referral_unique UNIQUE (referral_id)
);

-- ---------------------------------------------------------------------------
-- Turbo Boost requests
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS turbo_boost_requests (
  id              VARCHAR(64)  PRIMARY KEY,
  reference       VARCHAR(40)  NOT NULL UNIQUE,
  subscriber_id   VARCHAR(100) NOT NULL,
  duration_hours  INTEGER      NOT NULL,
  requested_mbps  INTEGER      NOT NULL,
  status          VARCHAR(30)  NOT NULL DEFAULT 'requested',
  admin_note      TEXT,
  decided_by      VARCHAR(100),
  decided_at      TIMESTAMPTZ,
  applied_at      TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  deactivated_at  TIMESTAMPTZ,
  ticket_id       VARCHAR(100),
  raw_data        JSONB,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id              VARCHAR(64)  PRIMARY KEY,
  user_id         VARCHAR(100) NOT NULL,
  recipient_type  VARCHAR(20)  NOT NULL DEFAULT 'subscriber',
  role_target     VARCHAR(50),
  type            VARCHAR(60)  NOT NULL DEFAULT 'system',
  title           VARCHAR(255) NOT NULL,
  message         TEXT         NOT NULL,
  link            VARCHAR(500),
  is_read         BOOLEAN      NOT NULL DEFAULT FALSE,
  raw_data        JSONB,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- User Preferences
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id         VARCHAR(64) PRIMARY KEY,
  theme           VARCHAR(20) DEFAULT 'system',
  theme_color     VARCHAR(30) DEFAULT 'blue',
  font_size       VARCHAR(10) DEFAULT 'md',
  language        VARCHAR(10) DEFAULT 'en',
  auto_save       BOOLEAN DEFAULT true,
  raw_data        JSONB DEFAULT '{}'::jsonb,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Backward-compatibility column additions for existing tables
-- ---------------------------------------------------------------------------
ALTER TABLE packages ADD COLUMN IF NOT EXISTS routeros_profile VARCHAR(100);
ALTER TABLE packages ADD COLUMN IF NOT EXISTS max_limit VARCHAR(50);

ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS first_name VARCHAR(120);
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS last_name  VARCHAR(120);
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS theme      VARCHAR(20) DEFAULT 'system';

ALTER TABLE api_users ADD COLUMN IF NOT EXISTS previous_login_at TIMESTAMPTZ;
ALTER TABLE api_users ADD COLUMN IF NOT EXISTS last_login_ip     VARCHAR(80);

ALTER TABLE subscriber_credentials ADD COLUMN IF NOT EXISTS previous_login_at TIMESTAMPTZ;
ALTER TABLE subscriber_credentials ADD COLUMN IF NOT EXISTS last_login_ip     VARCHAR(80);

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS installation_fee    NUMERIC(12,2) NOT NULL DEFAULT 0.00;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_fee             NUMERIC(12,2) NOT NULL DEFAULT 0.00;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS late_fee            NUMERIC(12,2) NOT NULL DEFAULT 0.00;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS carried_over_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS late_fee_applied    BOOLEAN       NOT NULL DEFAULT FALSE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_type        VARCHAR(50)   DEFAULT 'subscription';

ALTER TABLE turbo_boost_requests ADD COLUMN IF NOT EXISTS expires_at     TIMESTAMPTZ;
ALTER TABLE turbo_boost_requests ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;

ALTER TABLE payment_webhooks ADD COLUMN IF NOT EXISTS event_id VARCHAR(100);
ALTER TABLE payment_webhooks ADD COLUMN IF NOT EXISTS provider VARCHAR(50);
ALTER TABLE payment_webhooks ADD COLUMN IF NOT EXISTS transaction_reference VARCHAR(150);
ALTER TABLE payment_webhooks ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE payment_webhooks ADD COLUMN IF NOT EXISTS last_error_category VARCHAR(80);
ALTER TABLE payment_webhooks ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;
ALTER TABLE payment_webhooks ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ DEFAULT NOW();

-- ---------------------------------------------------------------------------
-- Indexes (IF NOT EXISTS keeps re-runs safe)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (order_status);

CREATE INDEX IF NOT EXISTS idx_cancellations_subscriber ON cancellations (subscriber_id);
CREATE INDEX IF NOT EXISTS idx_cancellations_status ON cancellations (status);

CREATE INDEX IF NOT EXISTS idx_network_devices_status ON network_devices (status);

CREATE INDEX IF NOT EXISTS idx_invoices_subscriber ON invoices (subscriber_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status     ON invoices (status);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date   ON invoices (due_date);

CREATE INDEX IF NOT EXISTS idx_subscribers_status  ON subscribers (status);
CREATE INDEX IF NOT EXISTS idx_subscribers_email   ON subscribers (email);
CREATE INDEX IF NOT EXISTS idx_subscribers_phone   ON subscribers (phone);

CREATE INDEX IF NOT EXISTS idx_subscriber_billing_next_invoice ON subscriber_billing (next_invoice_date);
CREATE INDEX IF NOT EXISTS idx_subscriber_billing_status       ON subscriber_billing (status);

CREATE INDEX IF NOT EXISTS idx_payment_txn_invoice    ON payment_transactions (invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_txn_subscriber ON payment_transactions (subscriber_id);
CREATE INDEX IF NOT EXISTS idx_payment_txn_status     ON payment_transactions (status);
CREATE INDEX IF NOT EXISTS idx_payment_txn_gateway_id ON payment_transactions (gateway, gateway_txn_id);

CREATE INDEX IF NOT EXISTS idx_payment_webhooks_gateway ON payment_webhooks (gateway);
CREATE INDEX IF NOT EXISTS idx_payment_webhooks_txn     ON payment_webhooks (gateway_txn_id);
CREATE INDEX IF NOT EXISTS idx_payment_webhooks_provider ON payment_webhooks (provider);
CREATE INDEX IF NOT EXISTS idx_payment_webhooks_txn_ref ON payment_webhooks (transaction_reference);
CREATE INDEX IF NOT EXISTS idx_payment_webhooks_status ON payment_webhooks (status);
CREATE INDEX IF NOT EXISTS idx_payment_webhooks_retry ON payment_webhooks (status, next_retry_at)
  WHERE status IN ('pending', 'failed');
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_webhooks_provider_event_id
  ON payment_webhooks (provider, event_id)
  WHERE event_id IS NOT NULL;

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

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriber_credentials_username_unique
  ON subscriber_credentials (username)
  WHERE username IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_referral_codes_code     ON referral_codes (code);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer      ON referrals (referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_status        ON referrals (status);
CREATE INDEX IF NOT EXISTS idx_referrals_code          ON referrals (code);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_sub    ON referral_rewards (subscriber_id);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_status ON referral_rewards (status);
CREATE INDEX IF NOT EXISTS idx_turbo_reference         ON turbo_boost_requests (reference);
CREATE INDEX IF NOT EXISTS idx_turbo_subscriber        ON turbo_boost_requests (subscriber_id);
CREATE INDEX IF NOT EXISTS idx_turbo_status            ON turbo_boost_requests (status);

CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON notifications (user_id, recipient_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (user_id, recipient_type, is_read);
