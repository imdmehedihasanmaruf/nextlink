// Verify the production startup safety net: it must refuse to boot without a
// strong JWT secret and with non-live integrations.
process.env.NODE_ENV = 'production';
process.env.JWT_SECRET = '';
process.env.PAYMENT_MODE = 'mock';
process.env.MIKROTIK_MODE = 'simulator';
process.env.SMS_MODE = 'mock';
process.env.CORS_ORIGINS = '*';

try {
  require(require('path').join(__dirname, '..', 'src', 'config'));
  console.log('FAIL: production config booted anyway');
  process.exit(1);
} catch (error) {
  console.log('PASS: refused to boot in production without safe configuration');
  console.log('--- message ---');
  console.log(error.message);
  process.exit(0);
}
