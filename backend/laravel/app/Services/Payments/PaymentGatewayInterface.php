<?php

namespace App\Services\Payments;

interface PaymentGatewayInterface
{
    /**
     * Get gateway identifier
     */
    public function getName(): string;

    /**
     * Create payment session / checkout redirect
     *
     * @param array{invoiceId: string, subscriberId?: ?string, amount: float|int, customer?: array} $params
     * @return array{success: bool, gateway: string, transactionId: string, redirectUrl: string, raw: array}
     */
    public function createPayment(array $params): array;

    /**
     * Verify payment status directly with provider API (server-to-server reconciliation)
     *
     * @param array{transactionId?: string, payload?: array} $params
     * @return array{success: bool, status: string, transactionId: string, amount: ?float, raw: array}
     */
    public function verifyPayment(array $params): array;

    /**
     * Parse incoming webhook callback payload into standardized shape
     *
     * @param array $body
     * @return array{transactionId: ?string, status: string, amount: ?float, raw: array}
     */
    public function parseWebhook(array $body): array;

    /**
     * Verify webhook signature and authenticity
     *
     * @param array $body
     * @return array{verified: bool, reason: string, amount?: ?float, transactionId?: ?string}
     */
    public function verifyWebhook(array $body): array;
}
