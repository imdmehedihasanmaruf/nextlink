const path = require('path');
const { Pool } = require(path.resolve('backend/node_modules/pg'));
const pool = new Pool({ connectionString: 'postgresql://postgres:Maruf%402000%23@localhost:5432/nextlink_db' });

async function migrate() {
  await pool.query(`
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
      payment_status VARCHAR(50) DEFAULT 'Payment Verified',
      order_status VARCHAR(50) DEFAULT 'Pending Activation',
      trx_id VARCHAR(100),
      next_billing_date VARCHAR(50),
      expected_activation_time VARCHAR(100),
      raw_data JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('orders table created successfully in PostgreSQL!');
  await pool.end();
}
migrate().catch(console.error);

