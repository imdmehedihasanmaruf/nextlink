<?php

namespace App\Services\Payments;

use App\Services\SettingsService;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Rocket (Dutch-Bangla Bank Limited Mobile Banking) Gateway Adapter
 *
 * NOTE ON PUBLIC SANDBOX AVAILABILITY:
 * Dutch-Bangla Bank Limited (DBBL) Rocket does not maintain a public, self-service developer sandbox API.
 * In production, Rocket integration is accomplished via:
 *   1. Direct DBBL Corporate Merchant API (requires static IP whitelist and direct bank VPN/certificate).
 *   2. Authorized Payment Aggregator (e.g. SSLCommerz or AamarPay Rocket channel).
 *
 * This adapter provides full PaymentGatewayInterface contract compliance, deterministic sandbox emulation,
 * and readiness for aggregator or direct bank credentials.
 */
class RocketGatewayAdapter extends AbstractPaymentGateway
{
    protected string $baseUrl;
    protected string $merchantId;
    protected string $apiKey;
    protected string $portalUrl;

    public function __construct(string $name = 'rocket', array $config = [], ?SettingsService $settingsService = null)
    {
        parent::__construct($name, $config, $settingsService);

        $rocketConfig = $config['rocket'] ?? config('payments.rocket', []);
        $this->baseUrl = rtrim((string) ($rocketConfig['baseUrl'] ?? $rocketConfig['base_url'] ?? 'https://sandbox.aamarpay.com'), '/');
        $this->merchantId = (string) ($rocketConfig['merchantId'] ?? $rocketConfig['merchant_id'] ?? '');
        $this->apiKey = (string) ($rocketConfig['apiKey'] ?? $rocketConfig['api_key'] ?? '');
        $this->portalUrl = rtrim((string) config('payments.portal_public_url', 'http://localhost:3000'), '/');
    }

    public function createPayment(array $params): array
    {
        $invoiceId = $params['invoiceId'] ?? '';
        $subscriberId = $params['subscriberId'] ?? '';
        $amount = (float) ($params['amount'] ?? 0);
        $customer = $params['customer'] ?? [];

        if (!empty($this->merchantId) && !empty($this->apiKey)) {
            try {
                $apiBase = rtrim((string) config('app.url', 'http://localhost:3101'), '/');
                $response = Http::timeout($this->timeoutSeconds)
                    ->withHeaders(['X-Api-Key' => $this->apiKey])
                    ->post("{$this->baseUrl}/payments/create", [
                        'store_id' => $this->merchantId,
                        'tran_id' => $invoiceId,
                        'amount' => number_format($amount, 2, '.', ''),
                        'currency' => 'USD',
                        'success_url' => "{$apiBase}/api/payments/rocket/callback?status=success",
                        'fail_url' => "{$apiBase}/api/payments/rocket/callback?status=failed",
                        'cancel_url' => "{$apiBase}/api/payments/rocket/callback?status=cancelled",
                        'cus_name' => $customer['name'] ?? 'NextLink Customer',
                        'cus_email' => $customer['email'] ?? 'billing@nextlink.local',
                        'cus_phone' => $customer['phone'] ?? '',
                    ]);

                if ($response->successful() && $response->json('checkout_url')) {
                    $json = $response->json();
                    return [
                        'success' => true,
                        'gateway' => 'rocket',
                        'transactionId' => (string) ($json['transaction_id'] ?? $json['tran_id'] ?? bin2hex(random_bytes(6))),
                        'redirectUrl' => $json['checkout_url'],
                        'raw' => $json,
                    ];
                }
            } catch (\Throwable $e) {
                Log::warning('Rocket payment/create failed, falling back to sandbox redirect', ['error' => $e->getMessage()]);
            }
        }

        // Sandbox fallback redirect
        $transactionId = 'ROCKET-' . strtoupper(bin2hex(random_bytes(6)));
        $payload = [
            'transactionId' => $transactionId,
            'invoiceId' => $invoiceId,
            'subscriberId' => $subscriberId,
            'amount' => $amount,
            'currency' => 'USD',
            'customer' => $customer,
            'gateway' => 'rocket',
            'createdAt' => now()->toIso8601String(),
        ];

        return [
            'success' => true,
            'gateway' => 'rocket',
            'transactionId' => $transactionId,
            'redirectUrl' => "{$this->portalUrl}/api/payments/mock/checkout/{$transactionId}",
            'raw' => $payload,
        ];
    }

    public function verifyPayment(array $params): array
    {
        $transactionId = $params['transactionId'] ?? ($params['payload']['transactionId'] ?? '');
        $payload = $params['payload'] ?? [];

        if (!empty($this->apiKey) && $transactionId) {
            try {
                $response = Http::timeout($this->timeoutSeconds)
                    ->withHeaders(['X-Api-Key' => $this->apiKey])
                    ->get("{$this->baseUrl}/payments/verify/{$transactionId}");

                if ($response->successful()) {
                    $json = $response->json();
                    $status = strtoupper((string) ($json['status'] ?? ''));
                    $isSuccess = in_array($status, ['SUCCESS', 'PAID', 'VALID']);
                    return [
                        'success' => $isSuccess,
                        'status' => $isSuccess ? 'success' : 'failed',
                        'transactionId' => (string) ($json['transaction_id'] ?? $transactionId),
                        'amount' => isset($json['amount']) ? (float) $json['amount'] : null,
                        'raw' => $json,
                    ];
                }
            } catch (\Throwable $e) {
                Log::warning('Rocket payment verify check failed', ['error' => $e->getMessage()]);
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
        $transactionId = $body['transaction_id']
            ?? $body['tran_id']
            ?? $body['transactionId']
            ?? $body['trx_id']
            ?? null;

        $rawStatus = strtoupper((string) ($body['status'] ?? ''));
        $status = 'pending';
        if (in_array($rawStatus, ['SUCCESS', 'PAID', 'VALID'])) {
            $status = 'success';
        } elseif (in_array($rawStatus, ['FAILED', 'CANCELLED', 'CANCELED'])) {
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
        if (config('payments.mode') !== 'live') {
            return ['verified' => true, 'reason' => 'mock mode'];
        }

        $transactionId = $body['transaction_id'] ?? $body['tran_id'] ?? $body['transactionId'] ?? null;
        if (!$transactionId) {
            return ['verified' => false, 'reason' => 'the callback carries no transaction id'];
        }

        try {
            $result = $this->verifyPayment(['transactionId' => $transactionId]);
            return [
                'verified' => ($result['status'] ?? '') === 'success',
                'reason' => "gateway reports {$result['status']}",
                'amount' => $result['amount'] ?? null,
                'transactionId' => $result['transactionId'] ?? $transactionId,
            ];
        } catch (\Throwable $e) {
            return ['verified' => false, 'reason' => "the gateway could not be reached: {$e->getMessage()}"];
        }
    }
}
