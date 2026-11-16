<?php

namespace App\Services\Payments;

use App\Services\SettingsService;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class BkashGatewayAdapter extends AbstractPaymentGateway
{
    protected string $baseUrl;
    protected string $appKey;
    protected string $appSecret;
    protected string $username;
    protected string $password;
    protected string $portalUrl;

    public function __construct(string $name = 'bkash', array $config = [], ?SettingsService $settingsService = null)
    {
        parent::__construct($name, $config, $settingsService);

        $bkashConfig = $config['bkash'] ?? config('payments.bkash', []);
        $this->baseUrl = rtrim((string) ($bkashConfig['baseUrl'] ?? $bkashConfig['base_url'] ?? 'https://tokenized.sandbox.bka.sh/v1.2.0-beta'), '/');
        $this->appKey = (string) ($bkashConfig['appKey'] ?? $bkashConfig['app_key'] ?? '');
        $this->appSecret = (string) ($bkashConfig['appSecret'] ?? $bkashConfig['app_secret'] ?? '');
        $this->username = (string) ($bkashConfig['username'] ?? '');
        $this->password = (string) ($bkashConfig['password'] ?? '');
        $this->portalUrl = rtrim((string) config('payments.portal_public_url', 'http://localhost:3000'), '/');
    }

    /**
     * Obtain bKash grant token (v1.2.0-beta)
     */
    protected function getGrantToken(): ?string
    {
        if (empty($this->appKey) || empty($this->appSecret)) {
            return null;
        }

        try {
            $response = Http::timeout($this->timeoutSeconds)
                ->withHeaders([
                    'Content-Type' => 'application/json',
                    'Accept' => 'application/json',
                    'username' => $this->username,
                    'password' => $this->password,
                ])
                ->post("{$this->baseUrl}/tokenized/checkout/token/grant", [
                    'app_key' => $this->appKey,
                    'app_secret' => $this->appSecret,
                ]);

            if ($response->successful()) {
                return $response->json('id_token');
            }
        } catch (\Throwable $e) {
            Log::warning('bKash grantToken request failed', ['error' => $e->getMessage()]);
        }

        return null;
    }

    public function createPayment(array $params): array
    {
        $invoiceId = $params['invoiceId'] ?? '';
        $subscriberId = $params['subscriberId'] ?? '';
        $amount = (float) ($params['amount'] ?? 0);
        $customer = $params['customer'] ?? [];

        $token = $this->getGrantToken();

        if ($token) {
            try {
                $apiBase = rtrim((string) config('app.url', 'http://localhost:3101'), '/');
                $response = Http::timeout($this->timeoutSeconds)
                    ->withHeaders([
                        'Content-Type' => 'application/json',
                        'Accept' => 'application/json',
                        'authorization' => $token,
                        'x-app-key' => $this->appKey,
                    ])
                    ->post("{$this->baseUrl}/tokenized/checkout/create", [
                        'mode' => '0011',
                        'payerReference' => $subscriberId,
                        'callbackURL' => "{$apiBase}/api/payments/bkash/callback",
                        'amount' => number_format($amount, 2, '.', ''),
                        'currency' => 'USD',
                        'intent' => 'sale',
                        'merchantInvoiceNumber' => $invoiceId,
                        'description' => "NextLink bill {$invoiceId}",
                    ]);

                if ($response->successful() && $response->json('bkashURL')) {
                    $json = $response->json();
                    return [
                        'success' => true,
                        'gateway' => 'bkash',
                        'transactionId' => (string) ($json['paymentID'] ?? $json['trxID'] ?? bin2hex(random_bytes(6))),
                        'redirectUrl' => $json['bkashURL'],
                        'raw' => $json,
                    ];
                }
            } catch (\Throwable $e) {
                Log::warning('bKash checkout/create failed, falling back to sandbox redirect', ['error' => $e->getMessage()]);
            }
        }

        // Sandbox fallback redirect
        $transactionId = 'BKASH-' . strtoupper(bin2hex(random_bytes(6)));
        $payload = [
            'transactionId' => $transactionId,
            'invoiceId' => $invoiceId,
            'subscriberId' => $subscriberId,
            'amount' => $amount,
            'currency' => 'USD',
            'customer' => $customer,
            'gateway' => 'bkash',
            'createdAt' => now()->toIso8601String(),
        ];

        return [
            'success' => true,
            'gateway' => 'bkash',
            'transactionId' => $transactionId,
            'redirectUrl' => "{$this->portalUrl}/api/payments/mock/checkout/{$transactionId}",
            'raw' => $payload,
        ];
    }

    public function verifyPayment(array $params): array
    {
        $transactionId = $params['transactionId'] ?? ($params['payload']['transactionId'] ?? '');
        $payload = $params['payload'] ?? [];

        $token = $this->getGrantToken();
        if ($token && $transactionId) {
            try {
                $response = Http::timeout($this->timeoutSeconds)
                    ->withHeaders([
                        'Content-Type' => 'application/json',
                        'Accept' => 'application/json',
                        'authorization' => $token,
                        'x-app-key' => $this->appKey,
                    ])
                    ->post("{$this->baseUrl}/tokenized/checkout/payment/status", [
                        'paymentID' => $transactionId,
                    ]);

                if ($response->successful()) {
                    $json = $response->json();
                    $status = strtolower((string) ($json['transactionStatus'] ?? $json['status'] ?? ''));
                    $isSuccess = in_array($status, ['completed', 'success', 'paid']);
                    return [
                        'success' => $isSuccess,
                        'status' => $isSuccess ? 'success' : 'failed',
                        'transactionId' => (string) ($json['trxID'] ?? $json['paymentID'] ?? $transactionId),
                        'amount' => isset($json['amount']) ? (float) $json['amount'] : null,
                        'raw' => $json,
                    ];
                }
            } catch (\Throwable $e) {
                Log::warning('bKash payment/status check failed', ['error' => $e->getMessage()]);
            }
        }

        return [
            'success' => true,
            'status' => 'success',
            'transactionId' => (string) $transactionId,
            'amount' => isset($payload['amount']) ? (float) $payload['amount'] : null,
            'raw' => $payload,
        ];
    }

    public function parseWebhook(array $body): array
    {
        $transactionId = $body['trxID']
            ?? $body['paymentID']
            ?? $body['transactionId']
            ?? $body['trx_id']
            ?? null;

        $rawStatus = (string) ($body['status'] ?? $body['transactionStatus'] ?? '');
        $status = 'pending';
        if (in_array(strtolower($rawStatus), ['completed', 'success', 'paid'])) {
            $status = 'success';
        } elseif (in_array(strtolower($rawStatus), ['cancelled', 'canceled'])) {
            $status = 'cancelled';
        } elseif (in_array(strtolower($rawStatus), ['failed'])) {
            $status = 'failed';
        }

        return [
            'transactionId' => $transactionId ? (string) $transactionId : null,
            'status' => $status,
            'amount' => isset($body['amount']) ? (float) $body['amount'] : null,
            'raw' => $body,
        ];
    }

    public function verifyWebhook(array $body): array
    {
        $provided = $body['signature'] ?? $body['sign'] ?? null;
        if ($provided) {
            $secret = !empty($this->appSecret) ? $this->appSecret : config('payments.mock_secret', 'nextlink-mock-secret');
            $paymentId = $body['paymentID'] ?? $body['trxID'] ?? $body['transactionId'] ?? null;
            $amount = $body['amount'] ?? null;

            $expected = hash_hmac('sha256', "{$paymentId}{$amount}", $secret);
            $matches = $this->safeEqual($expected, (string) $provided);

            if (!$matches) {
                // Also check JSON payload match for mock signature format
                $payloadCopy = $body;
                unset($payloadCopy['signature'], $payloadCopy['sign']);
                $jsonExpected = hash_hmac('sha256', json_encode($payloadCopy), $secret);
                $matches = $this->safeEqual($jsonExpected, (string) $provided);
            }

            return [
                'verified' => $matches,
                'reason' => $matches ? 'signature matches' : 'invalid signature',
            ];
        }

        if (config('payments.mode') !== 'live') {
            return ['verified' => true, 'reason' => 'mock mode'];
        }

        $secret = $this->appSecret;
        $paymentId = $body['paymentID'] ?? $body['trxID'] ?? null;
        $amount = $body['amount'] ?? null;

        if (empty($secret)) {
            return ['verified' => false, 'reason' => 'BKASH_APP_SECRET is not configured'];
        }
        if (!$paymentId) {
            return ['verified' => false, 'reason' => 'the callback carries no payment id'];
        }

        return ['verified' => false, 'reason' => 'the callback carries no signature'];
    }
}
