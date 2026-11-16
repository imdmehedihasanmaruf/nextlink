<?php

namespace App\Jobs;

use App\Services\MikroTik\MikroTikService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class SyncMikroTikSubscriberJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public string $subscriberId;
    public string $action; // 'sync', 'suspend', 'restore', 'apply_profile'
    public array $params;

    public int $tries = 3;
    public int $backoff = 10;

    public function __construct(string $subscriberId, string $action = 'sync', array $params = [])
    {
        $this->subscriberId = $subscriberId;
        $this->action = $action;
        $this->params = $params;
    }

    public function handle(MikroTikService $mikrotik): void
    {
        Log::info("Processing SyncMikroTikSubscriberJob for {$this->subscriberId} [Action: {$this->action}]");

        match ($this->action) {
            'suspend' => $mikrotik->suspendSubscriber($this->subscriberId),
            'restore' => $mikrotik->restoreSubscriber($this->subscriberId),
            'apply_profile' => $mikrotik->applyBandwidthProfile(
                $this->subscriberId,
                $this->params['profile'] ?? 'nl-25m',
                $this->params['maxLimit'] ?? null
            ),
            default => $mikrotik->syncSubscriber($this->subscriberId),
        };
    }

    public function failed(\Throwable $exception): void
    {
        Log::error("SyncMikroTikSubscriberJob permanently failed for {$this->subscriberId}: {$exception->getMessage()}");
    }
}
