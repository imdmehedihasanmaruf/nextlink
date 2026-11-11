'use strict';

/**
 * A mock of the local payment gateways and the SMS gateway.
 *
 * It implements the *real* request and response contracts of bKash Tokenized
 * Checkout, Nagad, SSLCommerz and a generic local SMS gateway, so the live
 * code path (`PAYMENT_MODE=live`, `SMS_MODE=live`) can be verified without
 * real merchant credentials.
 *
 * Usage:
 *   node scripts/mock-gateway-server.js [port]
 */

const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = Number(process.argv[2] || process.env.MOCK_GATEWAY_PORT || 18729);

/** Tokens issued by the bKash grant endpoint. */
const bkashTokens = new Map();

/** Transactions created by any gateway. */
const transactions = new Map();

/** SMS messages received by the SMS gateway. */
const smsMessages = [];

/**
 * Read and parse the request body.
 */
function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

/**
 * Parse a JSON or urlencoded body.
 */
function parseBody(raw, contentType) {
  if (!raw) return {};
  if (contentType && contentType.includes('application/json')) {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  const params = new URLSearchParams(raw);
  const result = {};
  for (const [key, value] of params.entries()) result[key] = value;
  return result;
}

function json(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const raw = await readBody(request);
  const body = parseBody(raw, request.headers['content-type']);
  const auth = request.headers.authorization || '';

  console.log(`${request.method} ${path}${Object.keys(body).length ? ' ' + JSON.stringify(body).slice(0, 120) : ''}`);

  // -----------------------------------------------------------------------
  // bKash Tokenized Checkout
  // -----------------------------------------------------------------------
  if (path === '/tokenized/checkout/token/grant') {
    if (body.username !== 'bkash-user' || body.password !== 'bkash-pass') {
      return json(response, 200, {
        statusCode: '4001',
        statusMessage: 'Invalid user name or password',
      });
    }
    const token = `id_token_${crypto.randomBytes(12).toString('hex')}`;
    bkashTokens.set(token, Date.now() + 50 * 60 * 1000);
    return json(response, 200, {
      id_token: token,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'checkout',
      refresh_token: `refresh_${crypto.randomBytes(8).toString('hex')}`,
    });
  }

  if (path === '/tokenized/checkout/create') {
    if (!bkashTokens.has(auth)) {
      return json(response, 200, { statusCode: '4037', statusMessage: 'Access token is invalid' });
    }
    const paymentId = `PAYID${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
    const trxId = `TRX${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
    // bKash signs the callback with the app secret.
    const signature = crypto
      .createHmac('sha256', 'demo-app-secret')
      .update(`${paymentId}${body.amount}`)
      .digest('hex');
    transactions.set(paymentId, {
      gateway: 'bkash',
      trxID: trxId,
      paymentID: paymentId,
      amount: body.amount,
      status: 'Completed',
      signature,
      merchantInvoiceNumber: body.merchantInvoiceNumber,
    });
    return json(response, 200, {
      bkashURL: `http://localhost:${PORT}/bkash/checkout/${paymentId}`,
      paymentID: paymentId,
      trxID: trxId,
      amount: body.amount,
      currency: body.currency,
    });
  }

  if (path === '/tokenized/checkout/payment/status') {
    if (!bkashTokens.has(auth)) {
      return json(response, 200, { statusCode: '4037', statusMessage: 'Access token is invalid' });
    }
    const record = transactions.get(body.paymentID);
    if (!record) {
      return json(response, 200, { statusCode: '2004', statusMessage: 'Payment not found' });
    }
    return json(response, 200, {
      trxID: record.trxID,
      paymentID: record.paymentID,
      amount: record.amount,
      status: record.status,
    });
  }

  if (path.startsWith('/bkash/checkout/')) {
    const paymentId = path.split('/').pop();
    const record = transactions.get(paymentId);
    // The checkout page shows the signed callback values, exactly like the
    // real bKash checkout redirects back with them.
    return response.end(
      `<!doctype html><html><body style="font-family:system-ui;padding:40px">
       <h2>bKash checkout</h2>
       <p>Invoice: ${record ? record.merchantInvoiceNumber : paymentId}</p>
       <p>Amount: USD ${record ? record.amount : '—'}</p>
       <p>Transaction: ${record ? record.trxID : '—'}</p>
       <p>paymentID: ${paymentId}</p>
       <p>status: Completed</p>
       <p>signature: ${record ? record.signature : ''}</p>
       </body></html>`
    );
  }

  // -----------------------------------------------------------------------
  // Nagad
  // -----------------------------------------------------------------------
  if (path === '/api/merchant/token') {
    return json(response, 200, {
      sensitiveData: `nagad_token_${crypto.randomBytes(10).toString('hex')}`,
      expiresIn: 3600,
    });
  }

  if (path === '/api/merchant/payment/create') {
    const transactionId = `NGD${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
    transactions.set(transactionId, {
      gateway: 'nagad',
      transactionId,
      amount: body.txnAmount,
      status: 'SUCCESS',
      merchantInvoiceNumber: body.merchantInvoiceNumber,
    });
    return json(response, 200, {
      paymentUrl: `http://localhost:${PORT}/nagad/checkout/${transactionId}`,
      transactionId,
      amount: body.txnAmount,
    });
  }

  if (path === '/api/merchant/payment/verify') {
    const record = transactions.get(body.transactionId);
    if (!record) {
      return json(response, 200, { status: 'FAILED', message: 'Transaction not found' });
    }
    return json(response, 200, {
      transactionId: record.transactionId,
      status: record.status,
      amount: record.amount,
      merchantInvoiceNumber: record.merchantInvoiceNumber,
    });
  }

  if (path.startsWith('/nagad/checkout/')) {
    const transactionId = path.split('/').pop();
    const record = transactions.get(transactionId);
    return response.end(
      `<!doctype html><html><body style="font-family:system-ui;padding:40px">
       <h2>Nagad checkout</h2>
       <p>Invoice: ${record ? record.merchantInvoiceNumber : transactionId}</p>
       <p>Amount: USD ${record ? record.amount : '—'}</p>
       </body></html>`
    );
  }

  // -----------------------------------------------------------------------
  // SSLCommerz
  // -----------------------------------------------------------------------
  if (path === '/gwprocess/v4/api.php') {
    if (body.store_id !== 'ssl-store' || body.store_passwd !== 'ssl-pass') {
      return json(response, 200, { status: 'FAILED', failedreason: 'Store credential mismatch' });
    }
    const sessionkey = `SSLSESS${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
    transactions.set(sessionkey, {
      gateway: 'sslcommerz',
      sessionkey,
      tran_id: body.tran_id,
      amount: body.total_amount,
      status: 'VALID',
      val_id: `VAL${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
    });
    return json(response, 200, {
      status: 'SUCCESS',
      sessionkey,
      GatewayPageURL: `http://localhost:${PORT}/sslcommerz/checkout/${sessionkey}`,
    });
  }

  if (path === '/validator/api/validationserverAPI.php') {
    const record = transactions.get(body.val_id);
    if (!record) {
      return json(response, 200, { status: 'FAILED', failedreason: 'Transaction not found' });
    }
    return json(response, 200, {
      status: 'VALID',
      val_id: record.val_id,
      tran_id: record.tran_id,
      amount: record.amount,
      currency: 'USD',
      store_id: body.store_id,
    });
  }

  if (path.startsWith('/sslcommerz/checkout/')) {
    const sessionkey = path.split('/').pop();
    const record = transactions.get(sessionkey);
    return response.end(
      `<!doctype html><html><body style="font-family:system-ui;padding:40px">
       <h2>SSLCommerz checkout</h2>
       <p>Invoice: ${record ? record.tran_id : sessionkey}</p>
       <p>Amount: USD ${record ? record.amount : '—'}</p>
       </body></html>`
    );
  }

  // -----------------------------------------------------------------------
  // Rocket
  // -----------------------------------------------------------------------
  // The Rocket API is mounted under /api/v1, but the base URL may or may
  // not already contain it, so both spellings are accepted.
  if (path === '/api/v1/payments/create' || path === '/payments/create') {
    const transactionId = `RKT${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
    transactions.set(transactionId, {
      gateway: 'rocket',
      transaction_id: transactionId,
      amount: body.amount,
      status: 'completed',
      order_id: body.order_id,
    });
    return json(response, 200, {
      checkout_url: `http://localhost:${PORT}/rocket/checkout/${transactionId}`,
      transaction_id: transactionId,
      amount: body.amount,
    });
  }

  if (
    path.startsWith('/api/v1/payments/verify/') ||
    path.startsWith('/payments/verify/')
  ) {
    const transactionId = path.split('/').pop();
    const record = transactions.get(transactionId);
    if (!record) {
      return json(response, 200, { status: 'failed' });
    }
    return json(response, 200, {
      transaction_id: record.transaction_id,
      status: record.status,
      amount: record.amount,
    });
  }

  if (path.startsWith('/rocket/checkout/')) {
    const transactionId = path.split('/').pop();
    const record = transactions.get(transactionId);
    return response.end(
      `<!doctype html><html><body style="font-family:system-ui;padding:40px">
       <h2>Rocket checkout</h2>
       <p>Invoice: ${record ? record.order_id : transactionId}</p>
       <p>Amount: USD ${record ? record.amount : '—'}</p>
       </body></html>`
    );
  }

  // -----------------------------------------------------------------------
  // SMS gateway
  // -----------------------------------------------------------------------
  if (path === '/api/sms/send') {
    const message = {
      to: body.to,
      message: body.message,
      sender_id: body.sender_id,
      receivedAt: new Date().toISOString(),
      id: `SMS${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
    };
    smsMessages.push(message);
    return json(response, 200, { id: message.id, status: 'sent', to: body.to });
  }

  if (path === '/api/sms/messages') {
    return json(response, 200, { messages: smsMessages });
  }

  if (path === '/health') {
    return json(response, 200, { success: true, service: 'mock-gateway' });
  }

  return json(response, 404, { error: `No mock route for ${path}` });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Mock payment + SMS gateway server listening on 127.0.0.1:${PORT}`);
});

module.exports = { server, transactions, smsMessages };
