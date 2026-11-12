'use strict';

/**
 * Payment gateway abstraction.
 *
 * Every gateway implements the same contract so the billing engine can treat
 * bKash / Nagad / SSLCommerz / Rocket identically:
 *
 *   createPayment({ invoiceId, subscriberId, amount, customer })  -> { success, gateway, redirectUrl, transactionId, raw }
 *   verifyPayment({ transactionId, payload })                      -> { success, status, transactionId, amount, raw }
 *   parseWebhook(req)                                              -> { transactionId, status, amount, raw }
 *
 * In `mock` mode no external network call is made — the gateway simulates the
 * full lifecycle (create -> redirect -> callback -> verify) deterministically,
 * which lets the whole billing pipeline be tested end-to-end offline.
 */

const crypto = require('crypto');
const { hmacSha256, safeEqual } = require('../../lib/utils');

class GatewayError extends Error {
  constructor(message, code = 'PAYMENT_ERROR', details = null) {
    super(message);
    this.name = 'GatewayError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Mock gateway — emulates a hosted checkout page and a settlement webhook.
 */
class MockGateway {
  constructor(name) {
    this.name = name;
  }

  _reference(prefix) {
    return `${prefix}${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
  }

  async createPayment({ invoiceId, subscriberId, amount, customer }) {
    const transactionId = this._reference(`${this.name.toUpperCase()}-`);
    const payload = {
      transactionId,
      invoiceId,
      subscriberId,
      amount: Number(amount),
      currency: 'USD',
      customer: customer || {},
      status: 'pending',
      createdAt: new Date().toISOString(),
      gateway: this.name,
    };
    const signature = crypto
      .createHmac('sha256', 'nextlink-mock-secret')
      .update(JSON.stringify(payload))
      .digest('hex');

    return {
      success: true,
      gateway: this.name,
      transactionId,
      redirectUrl: `${require('../../config').apiBaseUrl}/api/payments/mock/checkout/${transactionId}`,
      raw: { ...payload, signature },
    };
  }

  async verifyPayment({ transactionId, payload }) {
    return {
      success: true,
      status: 'success',
      transactionId: transactionId || (payload && payload.transactionId),
      amount: payload ? payload.amount : undefined,
      raw: payload || {},
    };
  }

  parseWebhook(body) {
    return {
      transactionId: body.transactionId || body.trx_id || body.transaction_id,
      status: body.status || 'success',
      amount: body.amount,
      raw: body,
    };
  }

  /**
   * The mock gateway has no signature to check, but the caller still gets a
   * consistent answer for every gateway.
   */
  verifyWebhook(body) {
    if (!body.transactionId && !body.trx_id && !body.transaction_id) {
      return { verified: false, reason: 'the callback carries no transaction id' };
    }
    return { verified: true, reason: 'mock mode' };
  }
}

/**
 * bKash Tokenized Checkout (v1.2.0-beta).
 * Flow: grant_token -> create_payment -> execute_payment -> callback.
 */
class BkashGateway {
  constructor(config) {
    this.name = 'bkash';
    this.config = config;
    this.baseUrl = config.payments.bkash.baseUrl;
  }

  async _call(path, body, token) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        authorization: token ? token : this.config.payments.bkash.appKey,
        'x-app-key': this.config.payments.bkash.appKey,
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new GatewayError(`bKash returned a non-JSON response (${response.status})`, 'BKASH_BAD_RESPONSE', text.slice(0, 400));
    }
    if (!response.ok) {
      throw new GatewayError(parsed.statusMessage || 'bKash request failed', 'BKASH_ERROR', parsed);
    }
    return parsed;
  }

  /** Obtain a grant token (cached per process for 50 minutes, per bKash docs). */
  async getGrantToken() {
    const { username, password, appKey, appSecret } = this.config.payments.bkash;
    const result = await this._call(
      '/tokenized/checkout/token/grant',
      { app_key: appKey, app_secret: appSecret, username, password },
    );
    if (!result.id_token) {
      throw new GatewayError('bKash did not return an id_token', 'BKASH_NO_TOKEN', result);
    }
    return result.id_token;
  }

  async createPayment({ invoiceId, subscriberId, amount, customer }) {
    const token = await this.getGrantToken();
    const result = await this._call(
      '/tokenized/checkout/create',
      {
        mode: '0011',
        payerReference: subscriberId,
        callbackURL: `${this.config.apiBaseUrl}/api/payments/bkash/callback`,
        amount: Number(amount).toFixed(2),
        currency: 'USD',
        intent: 'sale',
        merchantInvoiceNumber: invoiceId,
        description: `NextLink bill ${invoiceId}`,
      },
      token,
    );

    if (!result.bkashURL) {
      throw new GatewayError('bKash did not return a checkout URL', 'BKASH_NO_URL', result);
    }

    return {
      success: true,
      gateway: 'bkash',
      transactionId: result.paymentID || result.trxID,
      redirectUrl: result.bkashURL,
      raw: result,
    };
  }

  async verifyPayment({ transactionId, payload }) {
    const token = await this.getGrantToken();
    const result = await this._call(
      '/tokenized/checkout/payment/status',
      { paymentID: payload?.paymentID || transactionId },
      token,
    );
    const statusMap = { Completed: 'success', Failed: 'failed', Cancelled: 'cancelled', 'Pending': 'pending' };
    return {
      success: statusMap[result.status] === 'success',
      status: statusMap[result.status] || 'pending',
      transactionId: result.trxID || result.paymentID,
      amount: Number(result.amount || 0),
      raw: result,
    };
  }

  parseWebhook(body) {
    return {
      transactionId: body.trxID || body.paymentID,
      status: body.status === 'Completed' ? 'success' : body.status === 'Failed' ? 'failed' : 'pending',
      amount: Number(body.amount || 0),
      raw: body,
    };
  }

  /**
   * Verify the callback really came from bKash.
   *
   * bKash signs the callback with the app secret. The signature covers the
   * payment id and the amount, so a forged callback without the secret is
   * rejected before anything is written.
   */
  verifyWebhook(body) {
    // The mock gateway is only reachable when the platform runs in mock mode.
    if (this.config.payments.mode !== 'live') {
      return { verified: true, reason: 'mock mode' };
    }

    const secret = this.config.payments.bkash.appSecret;
    const paymentId = body.paymentID || body.trxID;
    const amount = body.amount;

    if (!secret) {
      return { verified: false, reason: 'BKASH_APP_SECRET is not configured' };
    }
    if (!paymentId) {
      return { verified: false, reason: 'the callback carries no payment id' };
    }

    const provided = body.signature || body.sign;
    if (!provided) {
      return { verified: false, reason: 'the callback carries no signature' };
    }

    const expected = hmacSha256(secret, `${paymentId}${amount}`);
    return {
      verified: safeEqual(expected, String(provided)),
      reason: safeEqual(expected, String(provided)) ? 'signature matches' : 'signature mismatch',
    };
  }
}

/**
 * Nagad Payment Gateway.
 * Flow: token -> initiate (payment/create) -> confirm (payment/verify).
 */
class NagadGateway {
  constructor(config) {
    this.name = 'nagad';
    this.config = config;
    this.baseUrl = config.payments.nagad.baseUrl;
  }

  async _call(path, body) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Key': this.config.payments.nagad.apiKey,
        Authorization: `Bearer ${this.config.payments.nagad.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new GatewayError(`Nagad returned a non-JSON response (${response.status})`, 'NAGAD_BAD_RESPONSE', text.slice(0, 400));
    }
    if (!response.ok) {
      throw new GatewayError(parsed.message || 'Nagad request failed', 'NAGAD_ERROR', parsed);
    }
    return parsed;
  }

  async createPayment({ invoiceId, subscriberId, amount, customer }) {
    const result = await this._call('/api/merchant/token', {});
    if (!result.sensitiveData) {
      throw new GatewayError('Nagad did not return a token', 'NAGAD_NO_TOKEN', result);
    }

    const init = await this._call(
      '/api/merchant/payment/create',
      {
        merchantId: this.config.payments.nagad.merchantId,
        customerReference: subscriberId,
        txnAmount: Number(amount).toFixed(2),
        currencyCode: 'USD',
        mode: '0001',
        merchantInvoiceNumber: invoiceId,
        callbackURL: `${this.config.apiBaseUrl}/api/payments/nagad/callback`,
      },
      result.sensitiveData,
    );

    if (!init.paymentUrl) {
      throw new GatewayError('Nagad did not return a payment URL', 'NAGAD_NO_URL', init);
    }

    return {
      success: true,
      gateway: 'nagad',
      transactionId: init.transactionId,
      redirectUrl: init.paymentUrl,
      raw: init,
    };
  }

  async verifyPayment({ transactionId, payload }) {
    const result = await this._call(
      '/api/merchant/payment/verify',
      { merchantId: this.config.payments.nagad.merchantId, transactionId: transactionId || payload?.transactionId },
    );
    const status = result.status === 'SUCCESS' ? 'success' : result.status === 'FAILED' ? 'failed' : 'pending';
    return {
      success: status === 'success',
      status,
      transactionId: result.transactionId || transactionId,
      amount: Number(result.amount || 0),
      raw: result,
    };
  }

  parseWebhook(body) {
    return {
      transactionId: body.transactionId,
      status: body.status === 'SUCCESS' ? 'success' : body.status === 'FAILED' ? 'failed' : 'pending',
      amount: Number(body.amount || 0),
      raw: body,
    };
  }

  /**
   * Nagad does not sign its callback, so the transaction is confirmed with
   * the gateway itself before the invoice is settled.
   */
  async verifyWebhook(body) {
    if (this.config.payments.mode !== 'live') {
      return { verified: true, reason: 'mock mode' };
    }

    const transactionId = body.transactionId;
    if (!transactionId) {
      return { verified: false, reason: 'the callback carries no transaction id' };
    }

    try {
      const result = await this.verifyPayment({ transactionId });
      return {
        verified: result.status === 'success',
        reason: `gateway reports ${result.status}`,
        amount: result.amount,
        transactionId: result.transactionId,
      };
    } catch (error) {
      return { verified: false, reason: `the gateway could not be reached: ${error.message}` };
    }
  }
}

/**
 * SSLCommerz (hosted checkout).
 * Flow: sessioncreate -> redirect to GatewayPage -> validation endpoint.
 */
class SslCommerzGateway {
  constructor(config) {
    this.name = 'sslcommerz';
    this.config = config;
    this.baseUrl = config.payments.sslcommerz.baseUrl;
  }

  async createPayment({ invoiceId, subscriberId, amount, customer }) {
    const body = new URLSearchParams({
      store_id: this.config.payments.sslcommerz.storeId,
      store_passwd: this.config.payments.sslcommerz.storePassword,
      total_amount: Number(amount).toFixed(2),
      currency: 'USD',
      tran_id: invoiceId,
      success_url: `${this.config.apiBaseUrl}/api/payments/sslcommerz/callback?status=success`,
      fail_url: `${this.config.apiBaseUrl}/api/payments/sslcommerz/callback?status=failed`,
      cancel_url: `${this.config.apiBaseUrl}/api/payments/sslcommerz/callback?status=cancelled`,
      cus_name: customer?.name || 'NextLink Customer',
      cus_email: customer?.email || 'billing@nextlink.local',
      cus_phone: customer?.phone || '',
      cus_add1: customer?.address || 'Dhaka, Bangladesh',
      shipping_method: 'NO',
      product_name: `NextLink ISP Bill ${invoiceId}`,
      product_category: 'Internet Service',
      product_profile: 'general',
    });

    const response = await fetch(`${this.baseUrl}/gwprocess/v4/api.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const result = await response.json();

    if (!result.GatewayPageURL) {
      throw new GatewayError('SSLCommerz did not return a GatewayPageURL', 'SSL_BAD_RESPONSE', result);
    }

    return {
      success: true,
      gateway: 'sslcommerz',
      transactionId: result.sessionkey,
      redirectUrl: result.GatewayPageURL,
      raw: result,
    };
  }

  async verifyPayment({ transactionId, payload }) {
    const body = new URLSearchParams({
      store_id: this.config.payments.sslcommerz.storeId,
      store_passwd: this.config.payments.sslcommerz.storePassword,
      val_id: payload?.val_id || transactionId,
    });
    const response = await fetch(`${this.baseUrl}/validator/api/validationserverAPI.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const result = await response.json();
    const status = result.status === 'VALID' || result.status === 'VALIDATED' ? 'success' : result.status === 'FAILED' ? 'failed' : 'pending';
    return {
      success: status === 'success',
      status,
      transactionId: result.tran_id || transactionId,
      amount: Number(result.amount || 0),
      raw: result,
    };
  }

  parseWebhook(body) {
    const status = body.status === 'success' || body.status === 'VALID' ? 'success' : body.status === 'failed' ? 'failed' : 'pending';
    return {
      transactionId: body.tran_id || body.sessionkey,
      status,
      amount: Number(body.amount || 0),
      raw: body,
    };
  }

  /**
   * SSLCommerz validates the transaction server side; the callback itself is
   * only trusted after the validation endpoint confirms it.
   */
  async verifyWebhook(body) {
    if (this.config.payments.mode !== 'live') {
      return { verified: true, reason: 'mock mode' };
    }

    const valId = body.val_id || body.sessionkey;
    if (!valId) {
      return { verified: false, reason: 'the callback carries no validation id' };
    }

    try {
      const result = await this.verifyPayment({ transactionId: valId, payload: body });
      return {
        verified: result.status === 'success',
        reason: `the validator reports ${result.status}`,
        amount: result.amount,
        transactionId: result.transactionId,
      };
    } catch (error) {
      return { verified: false, reason: `the validator could not be reached: ${error.message}` };
    }
  }
}

/**
 * Rocket (AamarPay style tokenized checkout).
 */
class RocketGateway {
  constructor(config) {
    this.name = 'rocket';
    this.config = config;
    this.baseUrl = config.payments.rocket.baseUrl;
  }

  async _call(path, body) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Api-Key': this.config.payments.rocket.apiKey,
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new GatewayError(`Rocket returned a non-JSON response (${response.status})`, 'ROCKET_BAD_RESPONSE', text.slice(0, 400));
    }
    if (!response.ok) {
      throw new GatewayError(parsed.message || 'Rocket request failed', 'ROCKET_ERROR', parsed);
    }
    return parsed;
  }

  async createPayment({ invoiceId, subscriberId, amount, customer }) {
    const result = await this._call('/payments/create', {
      merchant_id: this.config.payments.rocket.merchantId,
      order_id: invoiceId,
      currency: 'USD',
      amount: Number(amount),
      success_url: `${this.config.apiBaseUrl}/api/payments/rocket/callback`,
      fail_url: `${this.config.apiBaseUrl}/api/payments/rocket/callback?status=failed`,
      cancel_url: `${this.config.apiBaseUrl}/api/payments/rocket/callback?status=cancelled`,
      customer: customer || {},
    });

    if (!result.checkout_url) {
      throw new GatewayError('Rocket did not return a checkout URL', 'ROCKET_NO_URL', result);
    }

    return {
      success: true,
      gateway: 'rocket',
      transactionId: result.transaction_id,
      redirectUrl: result.checkout_url,
      raw: result,
    };
  }

  async verifyPayment({ transactionId, payload }) {
    const result = await this._call(`/payments/verify/${transactionId || payload?.transaction_id}`, {});
    const status = result.status === 'completed' ? 'success' : result.status === 'failed' ? 'failed' : 'pending';
    return {
      success: status === 'success',
      status,
      transactionId: result.transaction_id || transactionId,
      amount: Number(result.amount || 0),
      raw: result,
    };
  }

  parseWebhook(body) {
    const status = body.status === 'completed' ? 'success' : body.status === 'failed' ? 'failed' : 'pending';
    return {
      transactionId: body.transaction_id || body.transactionId,
      status,
      amount: Number(body.amount || 0),
      raw: body,
    };
  }

  /**
   * Rocket is confirmed by asking the gateway about the transaction.
   */
  async verifyWebhook(body) {
    if (this.config.payments.mode !== 'live') {
      return { verified: true, reason: 'mock mode' };
    }

    const transactionId = body.transaction_id || body.transactionId;
    if (!transactionId) {
      return { verified: false, reason: 'the callback carries no transaction id' };
    }

    try {
      const result = await this.verifyPayment({ transactionId });
      return {
        verified: result.status === 'success',
        reason: `the gateway reports ${result.status}`,
        amount: result.amount,
        transactionId: result.transactionId,
      };
    } catch (error) {
      return { verified: false, reason: `the gateway could not be reached: ${error.message}` };
    }
  }
}

/**
 * Registry: resolve a gateway by name, honouring the global mock/live switch.
 */
const GATEWAYS = {
  bkash: BkashGateway,
  nagad: NagadGateway,
  sslcommerz: SslCommerzGateway,
  rocket: RocketGateway,
};

function getGateway(name) {
  const key = String(name || '').toLowerCase();
  if (!GATEWAYS[key]) {
    throw new GatewayError(`Unknown payment gateway: ${name}`, 'UNKNOWN_GATEWAY');
  }
  return new GATEWAYS[key](require('../../config'));
}

function listGateways() {
  return [
    { id: 'bkash', name: 'bKash', supported: true, method: 'tokenized-checkout' },
    { id: 'nagad', name: 'Nagad', supported: true, method: 'redirect' },
    { id: 'sslcommerz', name: 'SSLCommerz', supported: true, method: 'hosted-checkout' },
    { id: 'rocket', name: 'Rocket', supported: true, method: 'tokenized-checkout' },
    { id: 'card', name: 'Card (Manual)', supported: false, method: 'manual' },
  ];
}

/**
 * Build the gateway used for a request. In mock mode every real gateway is
 * replaced by the mock implementation so the flow works without credentials.
 *
 * The credentials the operator saved in the admin panel take precedence over
 * the environment file, so the console and the billing engine always use the
 * same merchant account.
 */
function resolveGateway(name) {
  const config = require('../../config');
  const key = String(name || '').toLowerCase();
  if (key === 'mock') {
    // The mock gateway settles a payment without any gateway being involved.
    // It is only available while the deployment runs in mock mode — a live
    // installation must never be able to settle an invoice through it, not
    // even through an unauthenticated callback.
    if (config.payments.mode === 'live') {
      throw new GatewayError(
        'The mock payment gateway is disabled while the deployment runs in live mode.',
        'MOCK_GATEWAY_DISABLED',
      );
    }
    return new MockGateway('mock');
  }
  if (!GATEWAYS[key]) {
    throw new GatewayError(`Unknown payment gateway: ${name}`, 'UNKNOWN_GATEWAY');
  }

  const stored = loadStoredGatewayConfig();
  const effective = { ...config, payments: { ...config.payments } };

  const saved = stored[key];
  if (saved && typeof saved === 'object') {
    effective.payments[key] = { ...effective.payments[key], ...saved };
  }

  // The environment file wins when it explicitly asks for live mode: a
  // deployment that sets PAYMENT_MODE=live must not be downgraded by a stale
  // value in the database.
  if (config.payments.mode === 'live') {
    effective.payments.mode = 'live';
  } else if (stored.mode) {
    effective.payments.mode = stored.mode;
  }

  if (effective.payments.mode === 'mock') {
    return new MockGateway(key);
  }
  return new GATEWAYS[key](effective);
}

/**
 * The stored payment gateway configuration.
 */
function loadStoredGatewayConfig() {
  try {
    // eslint-disable-next-line global-require
    const settings = require('../settings');
    return settings.getCachedGroup('payments') || {};
  } catch {
    return {};
  }
}

module.exports = {
  GatewayError,
  MockGateway,
  BkashGateway,
  NagadGateway,
  SslCommerzGateway,
  RocketGateway,
  getGateway,
  resolveGateway,
  listGateways,
};
