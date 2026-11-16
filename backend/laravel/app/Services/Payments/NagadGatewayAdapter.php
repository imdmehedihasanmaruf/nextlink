<?php

namespace App\Services\Payments;

use App\Services\SettingsService;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class NagadGatewayAdapter extends AbstractPaymentGateway
{
    protected string $baseUrl;
    protected string $merchantId;
    protected string $merchantPrivateKey;
    protected string $pgPublicKey;
    protected string $portalUrl;

    public function __construct(string $name = 'nagad', array $config = [], ?SettingsService $settingsService = null)
    {
        parent::__construct($name, $config, $settingsService);

        $nagadConfig = $config['nagad'] ?? config('payments.nagad', []);
        $this->baseUrl = rtrim((string) ($nagadConfig['baseUrl'] ?? $nagadConfig['base_url'] ?? 'http://sandbox.mynagad.com:10080/remote-payment-gateway-1.0/api/dfs'), '/');
        $this->merchantId = (string) ($nagadConfig['merchantId'] ?? $nagadConfig['merchant_id'] ?? '');
        $this->merchantPrivateKey = (string) ($nagadConfig['merchantPrivateKey'] ?? $nagadConfig['merchant_private_key'] ?? '');
        $this->pgPublicKey = (string) ($nagadConfig['pgPublicKey'] ?? $nagadConfig['pg_public_key'] ?? '');
        $this->portalUrl = rtrim((string) config('payments.portal_public_url', 'http://localhost:3000'), '/');
    }

    public function createPayment(array $params): array
    {
        $invoiceId = $params['invoiceId'] ?? '';
        $subscriberId = $params['subscriberId'] ?? '';
        $amount = (float) ($params['amount'] ?? 0);
        $customer = $params['customer'] ?? [];

        if (!empty($this->merchantId) && !empty($this->merchantPrivateKey)) {
            try {
                $apiBase = rtrim((string) config('app.url', 'http://localhost:3101'), '/');
                $tokenRes = Http::timeout($this->timeoutSeconds)
                    ->post("{$this->baseUrl}/api/merchant/token", [
                        'dateTime' => now('Asia/Dhaka')->format('YmdHis'),
                    ]);

                if ($tokenRes->successful() && $tokenRes->json('sensitiveData')) {
                    $initRes = Http::timeout($this->timeoutSeconds)
                        ->post("{$this->baseUrl}/api/merchant/payment/create", [
                            'merchantId' => $this->merchantId,
                            'customerReference' => $subscriberId,
                            'txnAmount' => number_format($amount, 2, '.', ''),
                            'currencyCode' => 'USD',
                            'mode' => '0001',
                            'merchantInvoiceNumber' => $invoiceId,
                            'callbackURL' => "{$apiBase}/api/payments/nagad/callback",
                        ]);

                    if ($initRes->successful() && $initRes->json('paymentUrl')) {
                        $json = $initRes->json();
                        return [
                            'success' => true,
                            'gateway' => 'nagad',
                            'transactionId' => (string) ($json['transactionId'] ?? bin2hex(random_bytes(6))),
                            'redirectUrl' => $json['paymentUrl'],
                            'raw' => $json,
                        ];
                    }
                }
            } catch (\Throwable $e) {
                Log::warning('Nagad payment/create failed, falling back to sandbox redirect', ['error' => $e->getMessage()]);
            }
        }

        // Sandbox fallback redirect
        $transactionId = 'NAGAD-' . strtoupper(bin2hex(random_bytes(6)));
        $payload = [
            'transactionId' => $transactionId,
            'invoiceId' => $invoiceId,
            'subscriberId' => $subscriberId,
            'amount' => $amount,
            'currency' => 'USD',
            'customer' => $customer,
            'gateway' => 'nagad',
            'createdAt' => now()->toIso8601String(),
        ];

        return [
            'success' => true,
            'gateway' => 'nagad',
            'transactionId' => $transactionId,
            'redirectUrl' => "{$this->portalUrl}/api/payments/mock/checkout/{$transactionId}",
            'raw' => $payload,
        ];
    }

    public function verifyPayment(array $params): array
    {
        $transactionId = $params['transactionId'] ?? ($params['payload']['transactionId'] ?? '');
        $payload = $params['payload'] ?? [];

        if (!empty($this->merchantId) && $transactionId) {
            try {
                $response = Http::timeout($this->timeoutSeconds)
                    ->post("{$this->baseUrl}/api/merchant/payment/verify", [
                        'merchantId' => $this->merchantId,
                        'transactionId' => $transactionId,
                    ]);

                if ($response->successful()) {
                    $json = $response->json();
                    $status = strtoupper((string) ($json['status'] ?? ''));
                    $isSuccess = in_array($status, ['SUCCESS', 'COMPLETED', 'PAID']);
                    return [
                        'success' => $isSuccess,
                        'status' => $isSuccess ? 'success' : 'failed',
                        'transactionId' => (string) ($json['transactionId'] ?? $transactionId),
                        'amount' => isset($json['amount']) ? (float) $json['amount'] : null,
                        'raw' => $json,
                    ];
                }
            } catch (\Throwable $e) {
                Log::warning('Nagad payment/verify check failed', ['error' => $e->getMessage()]);
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
        $transactionId = $body['transactionId']
            ?? $body['trx_id']
            ?? $body['transaction_id']
            ?? null;

        $rawStatus = strtoupper((string) ($body['status'] ?? ''));
        $status = 'pending';
        if (in_array($rawStatus, ['SUCCESS', 'COMPLETED', 'PAID'])) {
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

        $transactionId = $body['transactionId'] ?? null;
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
