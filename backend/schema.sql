-- ============================================================================
-- NextLink ISP — Core PostgreSQL Schema
-- ============================================================================

CREATE TABLE IF NOT EXISTS packages (
  id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  speed INTEGER DEFAULT 50,
  upload_speed INTEGER DEFAULT 50,
  price NUMERIC(10, 2) DEFAULT 0,
  duration INTEGER DEFAULT 30,
  description TEXT,
  subscriber_count INTEGER DEFAULT 0,
  features TEXT[] DEFAULT '{}',
  bdix_speed INTEGER DEFAULT 500,
  popular BOOLEAN DEFAULT false,
  routeros_profile VARCHAR(100),
  max_limit VARCHAR(50),
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subscribers (
  id VARCHAR(100) PRIMARY KEY,
  first_name VARCHAR(120),
  last_name VARCHAR(120),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(100),
  package_id VARCHAR(100),
  status VARCHAR(50) DEFAULT 'active',
  theme VARCHAR(20) DEFAULT 'system',
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoices (
  id VARCHAR(100) PRIMARY KEY,
  subscriber_id VARCHAR(100),
  amount NUMERIC(10, 2) DEFAULT 0,
  installation_fee NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  tax_fee NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  late_fee NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  carried_over_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  late_fee_applied BOOLEAN NOT NULL DEFAULT FALSE,
  invoice_type VARCHAR(50) DEFAULT 'subscription',
  status VARCHAR(50) DEFAULT 'unpaid',
  due_date VARCHAR(100),
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tickets (
  id VARCHAR(100) PRIMARY KEY,
  title TEXT,
  status VARCHAR(50) DEFAULT 'open',
  priority VARCHAR(50) DEFAULT 'medium',
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS technicians (
  id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(50) DEFAULT 'active',
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_users (
  id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  role VARCHAR(100) DEFAULT 'admin',
  status VARCHAR(50) DEFAULT 'active',
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS roles (
  id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_settings (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR(50) PRIMARY KEY,
  customer_id VARCHAR(50) NOT NULL,
  customer_name VARCHAR(150),
  connection_id VARCHAR(100),
  package_id VARCHAR(50) NOT NULL,
  package_name VARCHAR(100) NOT NULL,
  purchase_type VARCHAR(50) NOT NULL,
  current_package_id VARCHAR(50),
  current_package_name VARCHAR(100),
  download_speed INT DEFAULT 100,
  upload_speed INT DEFAULT 100,
  monthly_price NUMERIC(10,2) DEFAULT 0.00,
  prorated_adjustment NUMERIC(10,2) DEFAULT 0.00,
  installation_fee NUMERIC(10,2) DEFAULT 0.00,
  taxes NUMERIC(10,2) DEFAULT 0.00,
  discount NUMERIC(10,2) DEFAULT 0.00,
  total_payable NUMERIC(10,2) DEFAULT 0.00,
  payment_method VARCHAR(50),
  payment_status VARCHAR(50) DEFAULT 'Payment Pending',
  order_status VARCHAR(50) DEFAULT 'Pending Activation',
  trx_id VARCHAR(100),
  next_billing_date VARCHAR(50),
  expected_activation_time VARCHAR(100),
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cancellations (
  id VARCHAR(100) PRIMARY KEY,
  subscriber_id VARCHAR(100) NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  package_id VARCHAR(100),
  package_name VARCHAR(255),
  cancel_invoice_id VARCHAR(100),
  reason VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  buy_again_date VARCHAR(50),
  not_sure_buy_again BOOLEAN DEFAULT FALSE,
  cancel_date VARCHAR(20) NOT NULL,
  cancel_time VARCHAR(20) NOT NULL,
  city VARCHAR(100) DEFAULT 'Unknown',
  postal_code VARCHAR(50) DEFAULT 'Unknown',
  state VARCHAR(100) DEFAULT 'Unknown',
  country VARCHAR(100) DEFAULT 'Unknown',
  client_ip VARCHAR(100),
  timezone VARCHAR(50) DEFAULT 'UTC',
  status VARCHAR(50) DEFAULT 'Cancelled',
  effective_date VARCHAR(50),
  outstanding_balance NUMERIC(12, 2) DEFAULT 0.00,
  raw_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS network_devices (
  id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(100) NOT NULL,
  ip VARCHAR(100),
  location VARCHAR(255),
  status VARCHAR(50) DEFAULT 'online',
  raw_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Backward-compatibility column additions for existing installations
ALTER TABLE packages ADD COLUMN IF NOT EXISTS routeros_profile VARCHAR(100);
ALTER TABLE packages ADD COLUMN IF NOT EXISTS max_limit VARCHAR(50);
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS first_name VARCHAR(120);
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS last_name VARCHAR(120);
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS theme VARCHAR(20) DEFAULT 'system';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS installation_fee NUMERIC(12, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_fee NUMERIC(12, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS late_fee NUMERIC(12, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS carried_over_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS late_fee_applied BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_type VARCHAR(50) DEFAULT 'subscription';

-- Essential indexes
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (order_status);
CREATE INDEX IF NOT EXISTS idx_cancellations_subscriber ON cancellations (subscriber_id);
CREATE INDEX IF NOT EXISTS idx_network_devices_status ON network_devices (status);
