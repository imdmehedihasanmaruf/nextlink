<?php

namespace App\Services\Payments;

use App\Services\SettingsService;

class MockGatewayAdapter extends AbstractPaymentGateway
{
    protected string $portalUrl;
    protected string $mockSecret;

    public function __construct(string $name = 'mock', array $config = [], ?SettingsService $settingsService = null)
    {
        parent::__construct($name, $config, $settingsService);
        $this->portalUrl = rtrim((string) config('payments.portal_public_url', 'http://localhost:3000'), '/');
        $this->mockSecret = (string) config('payments.mock_secret', 'nextlink-mock-secret');
    }

    public function createPayment(array $params): array
    {
        $invoiceId = $params['invoiceId'] ?? '';
        $subscriberId = $params['subscriberId'] ?? '';
        $amount = (float) ($params['amount'] ?? 0);
        $customer = $params['customer'] ?? [];

        $transactionId = strtoupper($this->name) . '-' . strtoupper(bin2hex(random_bytes(6)));

        $payload = [
            'transactionId' => $transactionId,
            'invoiceId' => $invoiceId,
            'subscriberId' => $subscriberId,
            'amount' => $amount,
            'currency' => 'USD',
            'customer' => $customer,
            'status' => 'pending',
            'createdAt' => now()->toIso8601String(),
            'gateway' => $this->name,
        ];

        $signature = hash_hmac('sha256', json_encode($payload), $this->mockSecret);

        return [
            'success' => true,
            'gateway' => $this->name,
            'transactionId' => $transactionId,
            'redirectUrl' => "{$this->portalUrl}/api/payments/mock/checkout/{$transactionId}",
            'raw' => array_merge($payload, ['signature' => $signature]),
        ];
    }

    public function verifyPayment(array $params): array
    {
        $transactionId = $params['transactionId'] ?? '';
        $payload = $params['payload'] ?? [];

        return [
            'success' => true,
            'status' => 'success',
            'transactionId' => $transactionId ?: ($payload['transactionId'] ?? ''),
            'amount' => isset($payload['amount']) ? (float) $payload['amount'] : null,
            'raw' => $payload,
        ];
    }

    public function parseWebhook(array $body): array
    {
        $transactionId = $body['transactionId']
            ?? $body['trx_id']
            ?? $body['transaction_id']
            ?? $body['gateway_txn_id']
            ?? null;

        $rawStatus = strtolower((string) ($body['status'] ?? 'success'));
        if (in_array($rawStatus, ['success', 'completed', 'paid'])) {
            $normalizedStatus = 'success';
        } elseif (in_array($rawStatus, ['cancelled', 'canceled'])) {
            $normalizedStatus = 'cancelled';
        } elseif (in_array($rawStatus, ['failed', 'declined', 'error'])) {
            $normalizedStatus = 'failed';
        } else {
            $normalizedStatus = $rawStatus ?: 'pending';
        }

        return [
            'transactionId' => $transactionId ? (string) $transactionId : null,
            'status' => $normalizedStatus,
            'amount' => isset($body['amount']) ? (float) $body['amount'] : null,
            'raw' => $body,
        ];
    }

    public function verifyWebhook(array $body): array
    {
        $transactionId = $body['transactionId']
            ?? $body['trx_id']
            ?? $body['transaction_id']
            ?? $body['gateway_txn_id']
            ?? null;

        if (!$transactionId) {
            return [
                'verified' => false,
                'reason' => 'the callback carries no transaction id',
            ];
        }

        // If an explicit signature is provided, verify it
        if (isset($body['signature'])) {
            $expectedSignature = $body['signature'];
            $payloadCopy = $body;
            unset($payloadCopy['signature']);

            $computedSignature = hash_hmac('sha256', json_encode($payloadCopy), $this->mockSecret);
            if (!$this->safeEqual($computedSignature, (string) $expectedSignature)) {
                return [
                    'verified' => false,
                    'reason' => 'invalid signature',
                ];
            }
        }

        return [
            'verified' => true,
            'reason' => 'mock mode',
        ];
    }
}
