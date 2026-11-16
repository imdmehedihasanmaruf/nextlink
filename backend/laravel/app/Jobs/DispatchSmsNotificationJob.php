<?php

namespace App\Jobs;

use App\Services\Notifications\SmsNotificationService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class DispatchSmsNotificationJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public array $params;

    public int $tries = 3;
    public int $backoff = 5;

    public function __construct(array $params)
    {
        $this->params = $params;
    }

    public function handle(SmsNotificationService $smsService): void
    {
        Log::info("Processing DispatchSmsNotificationJob to " . ($this->params['phone'] ?? 'unknown'));
        $result = $smsService->send($this->params);

        if (!($result['success'] ?? false) && ($result['status'] ?? '') !== 'deduplicated') {
            throw new \RuntimeException($result['error'] ?? 'SMS dispatch failed');
        }
    }

    public function failed(\Throwable $exception): void
    {
        Log::error("DispatchSmsNotificationJob failed: {$exception->getMessage()}");
    }
}
