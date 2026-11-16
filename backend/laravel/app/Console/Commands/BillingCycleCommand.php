<?php

namespace App\Console\Commands;

use App\Services\BillingEngineService;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;

class BillingCycleCommand extends Command
{
    protected $signature = 'billing:cycle {--period= : Billing period in YYYY-MM format} {--dry-run : Run in dry-run mode without mutating invoices}';
    protected $description = 'Trigger monthly recurring billing cycle invoice generation';

    public function handle(BillingEngineService $billingEngine): int
    {
        $period = $this->option('period') ?: Carbon::now('UTC')->format('Y-m');
        $dryRun = (bool) $this->option('dry-run');

        $this->info("Starting billing cycle for period: {$period} (Dry Run: " . ($dryRun ? 'YES' : 'NO') . ")");

        $result = $billingEngine->runMonthlyCycle([
            'period' => $period,
            'dryRun' => $dryRun,
        ]);

        $this->info("Billing cycle completed: {$result['cycleId']}");
        $this->line(" - Invoices processed: " . ($result['invoiceCount'] ?? 0));
        $this->line(" - Invoices created: " . ($result['createdCount'] ?? 0));
        $this->line(" - Total amount: $" . ($result['totalAmount'] ?? '0.00'));
        $this->line(" - Due date: " . ($result['dueDate'] ?? 'N/A'));

        if (!empty($result['failures'])) {
            $this->warn("Failures encountered: " . count($result['failures']));
            foreach ($result['failures'] as $f) {
                $this->error("  * Subscriber: {$f['subscriberId']} - {$f['error']}");
            }
        }

        return 0;
    }
}
