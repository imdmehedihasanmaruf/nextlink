<?php

namespace App\Services\Payments;

use App\Services\SettingsService;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

abstract class AbstractPaymentGateway implements PaymentGatewayInterface
{
    protected string $name;
    protected array $config;
    protected ?SettingsService $settingsService;
    protected int $timeoutSeconds = 10;

    public function __construct(string $name, array $config = [], ?SettingsService $settingsService = null)
    {
        $this->name = strtolower($name);
        $this->config = $config;
        $this->settingsService = $settingsService;
    }

    public function getName(): string
    {
        return $this->name;
    }

    /**
     * Get configuration value with fallback
     */
    protected function getConfig(string $key, mixed $default = null): mixed
    {
        return data_get($this->config, $key, $default);
    }

    /**
     * Constant-time string comparison to prevent timing side-channel attacks
     */
    protected function safeEqual(?string $knownString, ?string $userInput): bool
    {
        if ($knownString === null || $userInput === null) {
            return false;
        }
        return hash_equals((string) $knownString, (string) $userInput);
    }

    /**
     * Perform HTTP POST request with timeout and error handling
     */
    protected function postJson(string $url, array $data, array $headers = []): array
    {
        try {
            $response = Http::timeout($this->timeoutSeconds)
                ->withHeaders($headers)
                ->post($url, $data);

            if ($response->successful()) {
                return $response->json() ?? [];
            }

            Log::warning("Gateway {$this->name} HTTP call failed", [
                'url' => $url,
                'status' => $response->status(),
                'body' => substr($response->body(), 0, 500),
            ]);

            return $response->json() ?? ['error' => $response->body()];
        } catch (\Throwable $e) {
            Log::error("Gateway {$this->name} exception during HTTP call", [
                'url' => $url,
                'message' => $e->getMessage(),
            ]);
            throw new \RuntimeException("Payment gateway {$this->name} communication error: {$e->getMessage()}", 0, $e);
        }
    }
}
