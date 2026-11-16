<?php

namespace App\Console\Commands;

use App\Models\Subscriber;
use App\Services\MikroTik\MikroTikService;
use Illuminate\Console\Command;

class MikroTikSyncCommand extends Command
{
    protected $signature = 'mikrotik:sync {subscriberId? : Optional subscriber ID to synchronize}';
    protected $description = 'Synchronize subscriber billing and activation status with MikroTik RouterOS';

    public function handle(MikroTikService $mikrotik): int
    {
        $subscriberId = $this->argument('subscriberId');

        if ($subscriberId) {
            $this->info("Synchronizing subscriber {$subscriberId} with MikroTik...");
            try {
                $result = $mikrotik->syncSubscriber($subscriberId);
                $this->info("Synchronization complete: " . json_encode($result));
                return 0;
            } catch (\Throwable $e) {
                $this->error("Failed to sync subscriber {$subscriberId}: {$e->getMessage()}");
                return 1;
            }
        }

        $this->info("Starting full subscriber router state synchronization sweep...");
        $subscribers = Subscriber::whereIn('status', ['active', 'suspended', 'disconnected'])->get();

        $synced = 0;
        $failed = 0;

        foreach ($subscribers as $sub) {
            try {
                $mikrotik->syncSubscriber($sub->id);
                $synced++;
            } catch (\Throwable $e) {
                $failed++;
                $this->warn("Subscriber {$sub->id} sync error: {$e->getMessage()}");
            }
        }

        $this->info("MikroTik sync complete: {$synced} synced, {$failed} failed.");
        return 0;
    }
}
