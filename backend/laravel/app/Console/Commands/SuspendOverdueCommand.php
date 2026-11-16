<?php

namespace App\Console\Commands;

use App\Services\BillingEngineService;
use Illuminate\Console\Command;

class SuspendOverdueCommand extends Command
{
    protected $signature = 'billing:suspend-overdue';
    protected $description = 'Auto-suspend subscribers whose unpaid bills exceeded the grace period';

    public function handle(BillingEngineService $billingEngine): int
    {
        $this->info("Scanning for overdue unpaid invoices beyond grace period...");

        $result = $billingEngine->autoSuspendOverdue();

        $processed = $result['processed'] ?? 0;
        $this->info("Completed overdue sweep. Records evaluated: {$processed}");

        if (!empty($result['results'])) {
            foreach ($result['results'] as $r) {
                $this->line(" - Subscriber {$r['subscriberId']}: Invoice {$r['invoiceId']} -> Status: {$r['status']}");
            }
        }

        return 0;
    }
}
