<?php

namespace App\Services\Payments;

use App\Services\SettingsService;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class SslCommerzGatewayAdapter extends AbstractPaymentGateway
{
    protected string $baseUrl;
    protected string $storeId;
    protected string $storePassword;
    protected string $portalUrl;

    public function __construct(string $name = 'sslcommerz', array $config = [], ?SettingsService $settingsService = null)
    {
        parent::__construct($name, $config, $settingsService);

        $sslConfig = $config['sslcommerz'] ?? config('payments.sslcommerz', []);
        $this->baseUrl = rtrim((string) ($sslConfig['baseUrl'] ?? $sslConfig['base_url'] ?? 'https://sandbox.sslcommerz.com'), '/');
        $this->storeId = (string) ($sslConfig['storeId'] ?? $sslConfig['store_id'] ?? '');
        $this->storePassword = (string) ($sslConfig['storePassword'] ?? $sslConfig['store_passwd'] ?? '');
        $this->portalUrl = rtrim((string) config('payments.portal_public_url', 'http://localhost:3000'), '/');
    }

    public function createPayment(array $params): array
    {
        $invoiceId = $params['invoiceId'] ?? '';
        $subscriberId = $params['subscriberId'] ?? '';
        $amount = (float) ($params['amount'] ?? 0);
        $customer = $params['customer'] ?? [];

        if (!empty($this->storeId) && !empty($this->storePassword)) {
            try {
                $apiBase = rtrim((string) config('app.url', 'http://localhost:3101'), '/');
                $response = Http::asForm()
                    ->timeout($this->timeoutSeconds)
                    ->post("{$this->baseUrl}/gwprocess/v4/api.php", [
                        'store_id' => $this->storeId,
                        'store_passwd' => $this->storePassword,
                        'total_amount' => number_format($amount, 2, '.', ''),
                        'currency' => 'USD',
                        'tran_id' => $invoiceId,
                        'success_url' => "{$apiBase}/api/payments/sslcommerz/callback?status=success",
                        'fail_url' => "{$apiBase}/api/payments/sslcommerz/callback?status=failed",
                        'cancel_url' => "{$apiBase}/api/payments/sslcommerz/callback?status=cancelled",
                        'cus_name' => $customer['name'] ?? 'NextLink Customer',
                        'cus_email' => $customer['email'] ?? 'billing@nextlink.local',
                        'cus_phone' => $customer['phone'] ?? '',
                        'cus_add1' => $customer['address'] ?? 'Dhaka, Bangladesh',
                        'shipping_method' => 'NO',
                        'product_name' => "NextLink ISP Bill {$invoiceId}",
                        'product_category' => 'Internet Service',
                        'product_profile' => 'general',
                    ]);

                if ($response->successful() && $response->json('GatewayPageURL')) {
                    $json = $response->json();
                    return [
                        'success' => true,
                        'gateway' => 'sslcommerz',
                        'transactionId' => (string) ($json['sessionkey'] ?? bin2hex(random_bytes(6))),
                        'redirectUrl' => $json['GatewayPageURL'],
                        'raw' => $json,
                    ];
                }
            } catch (\Throwable $e) {
                Log::warning('SSLCommerz session create failed, falling back to sandbox redirect', ['error' => $e->getMessage()]);
            }
        }

        // Sandbox fallback redirect
        $transactionId = 'SSL-' . strtoupper(bin2hex(random_bytes(6)));
        $payload = [
            'transactionId' => $transactionId,
            'invoiceId' => $invoiceId,
            'subscriberId' => $subscriberId,
            'amount' => $amount,
            'currency' => 'USD',
            'customer' => $customer,
            'gateway' => 'sslcommerz',
            'createdAt' => now()->toIso8601String(),
        ];

        return [
            'success' => true,
            'gateway' => 'sslcommerz',
            'transactionId' => $transactionId,
            'redirectUrl' => "{$this->portalUrl}/api/payments/mock/checkout/{$transactionId}",
            'raw' => $payload,
        ];
    }

    public function verifyPayment(array $params): array
    {
        $transactionId = $params['transactionId'] ?? ($params['payload']['transactionId'] ?? '');
        $payload = $params['payload'] ?? [];
        $valId = $payload['val_id'] ?? $transactionId;

        if (!empty($this->storeId) && !empty($this->storePassword) && $valId) {
            try {
                $response = Http::asForm()
                    ->timeout($this->timeoutSeconds)
                    ->post("{$this->baseUrl}/validator/api/validationserverAPI.php", [
                        'val_id' => $valId,
                        'store_id' => $this->storeId,
                        'store_passwd' => $this->storePassword,
                    ]);

                if ($response->successful()) {
                    $json = $response->json();
                    $status = strtoupper((string) ($json['status'] ?? ''));
                    $isSuccess = in_array($status, ['VALID', 'VALIDATED', 'SUCCESS']);
                    return [
                        'success' => $isSuccess,
                        'status' => $isSuccess ? 'success' : 'failed',
                        'transactionId' => (string) ($json['tran_id'] ?? $transactionId),
                        'amount' => isset($json['amount']) ? (float) $json['amount'] : null,
                        'raw' => $json,
                    ];
                }
            } catch (\Throwable $e) {
                Log::warning('SSLCommerz validator check failed', ['error' => $e->getMessage()]);
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
        $transactionId = $body['tran_id']
            ?? $body['sessionkey']
            ?? $body['transactionId']
            ?? $body['val_id']
            ?? null;

        $rawStatus = strtoupper((string) ($body['status'] ?? ''));
        $status = 'pending';
        if (in_array($rawStatus, ['VALID', 'VALIDATED', 'SUCCESS', 'PAID'])) {
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

        $valId = $body['val_id'] ?? $body['sessionkey'] ?? null;
        if (!$valId) {
            return ['verified' => false, 'reason' => 'the callback carries no validation id'];
        }

        try {
            $result = $this->verifyPayment(['transactionId' => $valId, 'payload' => $body]);
            return [
                'verified' => ($result['status'] ?? '') === 'success',
                'reason' => "the validator reports {$result['status']}",
                'amount' => $result['amount'] ?? null,
                'transactionId' => $result['transactionId'] ?? $valId,
            ];
        } catch (\Throwable $e) {
            return ['verified' => false, 'reason' => "the validator could not be reached: {$e->getMessage()}"];
        }
    }
}
