<?php

namespace App\Services;

use App\Services\Payments\BkashGatewayAdapter;
use App\Services\Payments\MockGatewayAdapter;
use App\Services\Payments\NagadGatewayAdapter;
use App\Services\Payments\PaymentGatewayInterface;
use App\Services\Payments\RocketGatewayAdapter;
use App\Services\Payments\SslCommerzGatewayAdapter;

class PaymentGatewayService
{
    protected SettingsService $settingsService;

    public function __construct(SettingsService $settingsService)
    {
        $this->settingsService = $settingsService;
    }

    /**
     * List supported payment gateways
     */
    public function listGateways(): array
    {
        return [
            ['id' => 'bkash', 'name' => 'bKash', 'supported' => true, 'method' => 'tokenized-checkout'],
            ['id' => 'nagad', 'name' => 'Nagad', 'supported' => true, 'method' => 'redirect'],
            ['id' => 'sslcommerz', 'name' => 'SSLCommerz', 'supported' => true, 'method' => 'hosted-checkout'],
            ['id' => 'rocket', 'name' => 'Rocket', 'supported' => true, 'method' => 'tokenized-checkout'],
            ['id' => 'card', 'name' => 'Card (Manual)', 'supported' => false, 'method' => 'manual'],
        ];
    }

    /**
     * Get active operating mode
     */
    public function getMode(): string
    {
        return (string) config('payments.mode', 'mock');
    }

    /**
     * Resolve provider gateway adapter by name
     */
    public function resolveGateway(string $name): PaymentGatewayInterface
    {
        $key = strtolower(trim($name));

        if ($key === 'mock') {
            $isProduction = config('app.env') === 'production'
                || strtolower((string) request()->header('X-Simulate-Production', '')) === 'true';

            if ($isProduction || config('payments.mode') === 'live') {
                throw new \RuntimeException(
                    'The mock payment gateway is disabled while the deployment runs in live mode.'
                );
            }
            return new MockGatewayAdapter('mock', [], $this->settingsService);
        }

        $allowed = ['bkash', 'nagad', 'sslcommerz', 'rocket'];
        if (!in_array($key, $allowed)) {
            throw new \InvalidArgumentException("Unknown payment gateway: {$name}");
        }

        $baseConfig = config('payments', []);
        $storedConfig = [];
        try {
            $storedConfig = $this->settingsService->getGroup('payments');
        } catch (\Throwable $e) {}

        $mergedConfig = array_merge($baseConfig, $storedConfig);

        $effectiveMode = config('payments.mode', 'mock');
        if ($effectiveMode !== 'live' && !empty($storedConfig['mode'])) {
            $effectiveMode = $storedConfig['mode'];
        }

        if ($effectiveMode === 'mock') {
            return new MockGatewayAdapter($key, $mergedConfig, $this->settingsService);
        }

        return match ($key) {
            'bkash' => new BkashGatewayAdapter($key, $mergedConfig, $this->settingsService),
            'nagad' => new NagadGatewayAdapter($key, $mergedConfig, $this->settingsService),
            'sslcommerz' => new SslCommerzGatewayAdapter($key, $mergedConfig, $this->settingsService),
            'rocket' => new RocketGatewayAdapter($key, $mergedConfig, $this->settingsService),
            default => new MockGatewayAdapter($key, $mergedConfig, $this->settingsService),
        };
    }

    /**
     * Create payment session / initiate transaction (Adapter Facade)
     */
    public function createPayment(string $gateway, array $params): array
    {
        return $this->resolveGateway($gateway)->createPayment($params);
    }

    /**
     * Verify payment status directly with gateway (Adapter Facade)
     */
    public function verifyPayment(string $gateway, array $params): array
    {
        return $this->resolveGateway($gateway)->verifyPayment($params);
    }

    /**
     * Parse webhook callback payload (Adapter Facade)
     */
    public function parseWebhook(string $gateway, array $body): array
    {
        return $this->resolveGateway($gateway)->parseWebhook($body);
    }

    /**
     * Verify webhook signature and authenticity (Adapter Facade)
     */
    public function verifyWebhook(string $gateway, array $body): array
    {
        return $this->resolveGateway($gateway)->verifyWebhook($body);
    }
}
