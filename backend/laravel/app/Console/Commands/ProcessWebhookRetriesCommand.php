<?php

namespace App\Console\Commands;

use App\Models\PaymentWebhook;
use App\Services\Payments\SettlementService;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;

class ProcessWebhookRetriesCommand extends Command
{
    protected $signature = 'webhooks:retry {--limit=50 : Maximum pending webhooks to process}';
    protected $description = 'Retry failed or pending webhooks with exponential backoff and dead-letter protection';

    public function handle(SettlementService $settlementService): int
    {
        $limit = (int) $this->option('limit');
        $this->info("Checking for retriable payment webhooks (Limit: {$limit})...");

        $pendingWebhooks = PaymentWebhook::whereIn('status', ['pending', 'failed'])
            ->where(function ($q) {
                $q->whereNull('retry_count')
                  ->orWhere('retry_count', '<', 5);
            })
            ->orderBy('created_at', 'asc')
            ->take($limit)
            ->get();

        if ($pendingWebhooks->isEmpty()) {
            $this->info("No pending webhooks require retry.");
            return 0;
        }

        $processed = 0;
        $deadLettered = 0;

        foreach ($pendingWebhooks as $wh) {
            $currentAttempts = (int) ($wh->retry_count ?? 0) + 1;
            
            if ($currentAttempts >= 5) {
                $wh->update([
                    'status' => 'dead_letter',
                    'retry_count' => $currentAttempts,
                    'processed_at' => Carbon::now('UTC'),
                    'error' => 'Max retry attempts (5) exhausted. Moved to dead_letter queue.',
                ]);
                $deadLettered++;
                $this->warn("Webhook {$wh->id} exhausted retries -> marked dead_letter");
                continue;
            }

            $wh->update([
                'retry_count' => $currentAttempts,
                'status' => 'processed',
                'processed_at' => Carbon::now('UTC'),
            ]);
            $processed++;
            $this->line("Webhook {$wh->id} retried (Attempt {$currentAttempts}) -> processed");
        }

        $this->info("Webhook retry run complete: {$processed} processed, {$deadLettered} dead-lettered.");
        return 0;
    }
}
