<?php

namespace App\Services;

use App\Models\BillingCycle;
use App\Models\BillingEvent;
use App\Models\Invoice;
use App\Models\Package;
use App\Models\Subscriber;
use App\Models\SubscriberBilling;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class BillingEngineService
{
    protected SettingsService $settingsService;

    public function __construct(SettingsService $settingsService)
    {
        $this->settingsService = $settingsService;
    }

    /**
     * Integer cents conversions
     */
    public static function toCents(float|int|string|null $amount): int
    {
        return (int) round(((float) ($amount ?? 0)) * 100);
    }

    public static function fromCents(int $cents): float
    {
        return round($cents / 100, 2);
    }

    public static function fromCentsStr(int $cents): string
    {
        return number_format($cents / 100, 2, '.', '');
    }

    /**
     * Load active billing fee configuration from system_settings.billing
     */
    public function getBillingConfig(): array
    {
        try {
            $group = $this->settingsService->getGroup('billing');
            $cancelGroup = $this->settingsService->getGroup('cancellation');

            $installationFee = (float) ($group['installation_fee'] ?? $group['installationFee'] ?? 8.99);
            $taxFee = (float) ($group['tax_fee'] ?? $group['taxFee'] ?? 0.99);
            $rawLateFeeType = strtolower((string) ($group['late_fee_type'] ?? $group['lateFeeType'] ?? 'percent'));
            $lateFeeType = $rawLateFeeType === 'flat' ? 'flat' : 'percent';
            $rawLateFeeVal = (float) ($group['late_fee_value'] ?? $group['lateFeeValue'] ?? $group['lateFeePercent'] ?? 10);
            $lateFeeValue = is_finite($rawLateFeeVal) && $rawLateFeeVal >= 0 ? $rawLateFeeVal : 10.0;
            $rechargeAfterCancelTreatAsNew = (bool) ($cancelGroup['rechargeAfterCancelTreatAsNew'] ?? $group['rechargeAfterCancelTreatAsNew'] ?? true);

            return [
                'currency' => strtoupper((string) ($group['currency'] ?? 'USD')),
                'currencySymbol' => '$',
                'dueDay' => (int) ($group['dueDay'] ?? 10),
                'lateGraceDays' => (int) ($group['lateGraceDays'] ?? 5),
                'suspendAfterDays' => (int) ($group['suspendAfterDays'] ?? 10),
                'timezone' => (string) ($group['timezone'] ?? 'UTC'),
                'installationFee' => self::fromCents(self::toCents($installationFee)),
                'installation_fee' => self::fromCents(self::toCents($installationFee)),
                'installationFeeCents' => self::toCents($installationFee),
                'taxFee' => self::fromCents(self::toCents($taxFee)),
                'tax_fee' => self::fromCents(self::toCents($taxFee)),
                'taxFeeCents' => self::toCents($taxFee),
                'late_fee_type' => $lateFeeType,
                'late_fee_value' => $lateFeeValue,
                'lateFeeType' => $lateFeeType,
                'lateFeeValue' => $lateFeeValue,
                'lateFeePercent' => $lateFeeValue,
                'rechargeAfterCancelTreatAsNew' => $rechargeAfterCancelTreatAsNew,
                'paymentMode' => 'mock',
            ];
        } catch (\Throwable $e) {
            return [
                'currency' => 'USD',
                'currencySymbol' => '$',
                'dueDay' => 10,
                'lateGraceDays' => 5,
                'suspendAfterDays' => 10,
                'timezone' => 'UTC',
                'installationFee' => 8.99,
                'installation_fee' => 8.99,
                'installationFeeCents' => 899,
                'taxFee' => 0.99,
                'tax_fee' => 0.99,
                'taxFeeCents' => 99,
                'late_fee_type' => 'percent',
                'late_fee_value' => 10.0,
                'lateFeeType' => 'percent',
                'lateFeeValue' => 10.0,
                'lateFeePercent' => 10.0,
                'rechargeAfterCancelTreatAsNew' => true,
                'paymentMode' => 'mock',
            ];
        }
    }

    public function getFeeConfig(): array
    {
        return $this->getBillingConfig();
    }

    public function calculateLateFeeCents(int $packagePriceCents, array $billingCfg): int
    {
        $lateFeeType = $billingCfg['lateFeeType'] ?? 'percent';
        if ($lateFeeType === 'flat') {
            return (int) round(((float) ($billingCfg['lateFeeValue'] ?? 0)) * 100);
        }
        $percent = (float) ($billingCfg['lateFeePercent'] ?? $billingCfg['lateFeeValue'] ?? 10.0);
        return (int) round($packagePriceCents * ($percent / 100));
    }

    public function formatPackageWithSpeed(Package $package): string
    {
        $speed = (int) ($package->speed ?? 0);
        if ($speed > 0) {
            return "{$package->name} ({$speed} Mbps)";
        }
        return (string) $package->name;
    }

    public function formatPeriodMonthYear(?string $period): string
    {
        if (!$period) {
            return Carbon::now('UTC')->format('F Y');
        }
        try {
            if (preg_match('/^\d{4}-\d{2}$/', $period)) {
                return Carbon::createFromFormat('Y-m', $period)->format('F Y');
            }
            return Carbon::parse($period)->format('F Y');
        } catch (\Throwable $e) {
            return (string) $period;
        }
    }

    public function dueDateForPeriod(string $period, int $dueDay): string
    {
        try {
            $dt = Carbon::createFromFormat('Y-m', $period);
            $daysInMonth = $dt->daysInMonth;
            $clampedDay = min(max(1, $dueDay), $daysInMonth);
            return $dt->day($clampedDay)->toDateString();
        } catch (\Throwable $e) {
            return Carbon::now('UTC')->toDateString();
        }
    }

    /**
     * Compute authoritative Subscriber Plan Invoice Quote (Parity with Express handleQuoteRequest)
     */
    public function calculateQuote(array $params): array
    {
        $subscriberId = trim((string) ($params['subscriberId'] ?? $params['customerId'] ?? ''));
        $packageId = trim((string) ($params['packageId'] ?? ''));
        $purchaseType = strtoupper(trim((string) ($params['purchaseType'] ?? 'NEW')));

        if (!$subscriberId) {
            throw new \InvalidArgumentException('subscriberId (or customerId) is required to calculate a billing quote.');
        }

        $subscriber = Subscriber::find($subscriberId);
        if (!$subscriber) {
            throw new \InvalidArgumentException("Subscriber not found: {$subscriberId}");
        }

        $subRaw = $subscriber->raw_data ?? [];
        $currentPackageId = $subscriber->package_id ?? ($subRaw['packageId'] ?? null);

        $targetPackage = null;
        if ($packageId) {
            $targetPackage = Package::find($packageId);
        }
        if (!$targetPackage && $currentPackageId) {
            $targetPackage = Package::find($currentPackageId);
        }
        if (!$targetPackage) {
            $targetPackage = Package::orderBy('price', 'asc')->first();
        }
        if (!$targetPackage) {
            throw new \RuntimeException('No internet package found in catalogue to generate billing quote.');
        }

        $targetPriceCents = self::toCents($targetPackage->price);
        $billingCfg = $this->getBillingConfig();
        $targetPackageLabel = $this->formatPackageWithSpeed($targetPackage);

        $period = Carbon::now('UTC')->format('Y-m');
        $dueDate = $this->dueDateForPeriod($period, $billingCfg['dueDay']);

        // Check prior unpaid invoices
        $allInvoices = Invoice::where('subscriber_id', $subscriberId)
            ->orderBy('created_at', 'asc')
            ->get();

        $openUnpaidInvoices = $allInvoices->filter(fn ($inv) => $inv->status === 'unpaid');

        $paidInvoicesCount = $allInvoices->filter(fn ($inv) => $inv->status === 'paid')->count();
        $paidOrdersCount = DB::table('orders')
            ->where('customer_id', $subscriberId)
            ->where(function ($q) {
                $q->whereRaw("UPPER(COALESCE(order_status, '')) = 'ACTIVE'")
                  ->orWhereRaw("LOWER(COALESCE(payment_status, '')) = 'PAID'");
            })->count();

        $subStatus = strtolower((string) ($subscriber->status ?? ''));
        $isCancelledSub = $subStatus === 'cancelled';
        $hasActiveSubscriptionHistory = $paidInvoicesCount > 0
            || $paidOrdersCount > 0
            || ($currentPackageId && $subStatus === 'active' && ($subRaw['isNewSubscriber'] ?? false) !== true && ($subRaw['source'] ?? '') !== 'self-register');

        $scenario = 'NEW_SUBSCRIBER';
        $scenarioNumber = 1;
        $badge = 'New Subscription';
        $lines = [];
        $installationFeeCents = 0;
        $taxFeeCents = 0;
        $carriedOverCents = 0;
        $lateFeeCents = 0;
        $unpaidInvoiceIds = [];

        if ($openUnpaidInvoices->isNotEmpty()) {
            // SCENARIO 3: OVERDUE BALANCE
            $scenario = 'OVERDUE_BALANCE';
            $scenarioNumber = 3;
            $badge = 'Overdue Balance';

            foreach ($openUnpaidInvoices as $mInv) {
                $unpaidInvoiceIds[] = $mInv->id;
                $mRaw = $mInv->raw_data ?? [];
                $missedPkgId = $mRaw['packageId'] ?? $currentPackageId ?? $targetPackage->id;
                $missedPkg = ($missedPkgId === $targetPackage->id) ? $targetPackage : (Package::find($missedPkgId) ?? $targetPackage);
                $missedPkgLabel = $this->formatPackageWithSpeed($missedPkg);

                $missedBaseCents = 0;
                if (isset($mRaw['subscriptionAmountCents']) && (int) $mRaw['subscriptionAmountCents'] > 0) {
                    $missedBaseCents = (int) $mRaw['subscriptionAmountCents'];
                } elseif (isset($mRaw['subscriptionAmount']) && (float) $mRaw['subscriptionAmount'] > 0) {
                    $missedBaseCents = self::toCents($mRaw['subscriptionAmount']);
                } elseif (isset($mRaw['packagePrice']) && (float) $mRaw['packagePrice'] > 0) {
                    $missedBaseCents = self::toCents($mRaw['packagePrice']);
                } else {
                    $netCents = self::toCents($mInv->amount)
                        - self::toCents($mInv->installation_fee)
                        - self::toCents($mInv->tax_fee)
                        - self::toCents($mInv->late_fee)
                        - self::toCents($mInv->carried_over_amount);
                    $missedBaseCents = $netCents > 0 ? $netCents : self::toCents($missedPkg->price);
                }

                $periodStr = $mRaw['period'] ?? $mInv->due_date ?? $mInv->created_at;
                $monthYearLabel = $this->formatPeriodMonthYear($periodStr);

                $lines[] = [
                    'code' => 'previous_month_fee',
                    'type' => 'carried_over',
                    'invoiceId' => $mInv->id,
                    'period' => $mRaw['period'] ?? '',
                    'monthYear' => $monthYearLabel,
                    'label' => "{$missedPkgLabel} previous month fee ({$monthYearLabel})",
                    'description' => "{$missedPkgLabel} previous month fee ({$monthYearLabel})",
                    'amountCents' => $missedBaseCents,
                    'amount' => self::fromCents($missedBaseCents),
                ];
                $carriedOverCents += $missedBaseCents;

                // Late fee
                $alreadyApplied = (bool) ($mInv->late_fee_applied || ($mRaw['lateFeeApplied'] ?? false));
                if (!$alreadyApplied) {
                    $feeForMissedMonth = $this->calculateLateFeeCents(self::toCents($missedPkg->price), $billingCfg);
                    if ($feeForMissedMonth > 0) {
                        $lines[] = [
                            'code' => 'late_fee',
                            'type' => 'late_fee',
                            'invoiceId' => $mInv->id,
                            'monthYear' => $monthYearLabel,
                            'label' => "Late Fee ({$billingCfg['lateFeePercent']}% on {$missedPkgLabel} for {$monthYearLabel})",
                            'description' => "Late Fee ({$billingCfg['lateFeePercent']}% on {$missedPkgLabel} for {$monthYearLabel})",
                            'amountCents' => $feeForMissedMonth,
                            'amount' => self::fromCents($feeForMissedMonth),
                        ];
                        $lateFeeCents += $feeForMissedMonth;
                    }
                }
            }

            // Current monthly subscription
            $lines[] = [
                'code' => 'subscription',
                'type' => 'subscription',
                'label' => "{$targetPackageLabel} — Current Month Subscription",
                'description' => "{$targetPackageLabel} — Current Month Subscription ({$period})",
                'amountCents' => $targetPriceCents,
                'amount' => self::fromCents($targetPriceCents),
            ];
        } elseif ($hasActiveSubscriptionHistory && !$isCancelledSub) {
            // SCENARIO 2: RENEWAL
            $scenario = 'RENEWAL';
            $scenarioNumber = 2;
            $badge = 'Monthly Renewal';

            $lines[] = [
                'code' => 'subscription',
                'type' => 'subscription',
                'label' => "{$targetPackageLabel} — Monthly Subscription",
                'description' => "{$targetPackageLabel} — Monthly Subscription ({$period})",
                'amountCents' => $targetPriceCents,
                'amount' => self::fromCents($targetPriceCents),
            ];
        } else {
            // SCENARIO 1: NEW SUBSCRIBER
            $scenario = 'NEW_SUBSCRIBER';
            $scenarioNumber = 1;
            $badge = 'New Subscription';

            $installationFeeCents = $billingCfg['installationFeeCents'];
            $taxFeeCents = $billingCfg['taxFeeCents'];

            $lines[] = [
                'code' => 'subscription',
                'type' => 'subscription',
                'label' => "{$targetPackageLabel} — First Month Subscription",
                'description' => "{$targetPackageLabel} — First Month Subscription ({$period})",
                'amountCents' => $targetPriceCents,
                'amount' => self::fromCents($targetPriceCents),
            ];

            if ($installationFeeCents > 0) {
                $lines[] = [
                    'code' => 'installation_fee',
                    'type' => 'installation_fee',
                    'label' => 'One-Time Installation Fee',
                    'description' => 'One-Time Installation Fee',
                    'amountCents' => $installationFeeCents,
                    'amount' => self::fromCents($installationFeeCents),
                ];
            }

            if ($taxFeeCents > 0) {
                $lines[] = [
                    'code' => 'tax_fee',
                    'type' => 'tax_fee',
                    'label' => 'Tax & Regulatory Fee',
                    'description' => 'Tax & Regulatory Fee',
                    'amountCents' => $taxFeeCents,
                    'amount' => self::fromCents($taxFeeCents),
                ];
            }
        }

        $totalCents = $targetPriceCents + $installationFeeCents + $taxFeeCents + $carriedOverCents + $lateFeeCents;
        $total = self::fromCents($totalCents);

        $quote = [
            'subscriberId' => $subscriber->id,
            'subscriberName' => $subscriber->name,
            'packageId' => $targetPackage->id,
            'packageName' => $targetPackage->name,
            'packageSpeed' => (int) ($targetPackage->speed ?? 0),
            'packagePrice' => (float) $targetPackage->price,
            'period' => $period,
            'dueDate' => $dueDate,
            'scenario' => $scenario,
            'scenarioNumber' => $scenarioNumber,
            'badge' => $badge,
            'baseAmount' => (float) $targetPackage->price,
            'baseAmountCents' => $targetPriceCents,
            'installationFee' => self::fromCents($installationFeeCents),
            'installationFeeCents' => $installationFeeCents,
            'taxFee' => self::fromCents($taxFeeCents),
            'taxFeeCents' => $taxFeeCents,
            'carriedOverAmount' => self::fromCents($carriedOverCents),
            'carriedOverCents' => $carriedOverCents,
            'lateFee' => self::fromCents($lateFeeCents),
            'lateFeeCents' => $lateFeeCents,
            'lateFeePercent' => $billingCfg['lateFeePercent'],
            'total' => $total,
            'totalAmount' => $total,
            'totalCents' => $totalCents,
            'lines' => $lines,
            'unpaidInvoiceIds' => $unpaidInvoiceIds,
            'currency' => $billingCfg['currency'],
        ];

        return $quote;
    }

    /**
     * Run monthly recurring billing cycle
     */
    public function runMonthlyCycle(array $params = []): array
    {
        $period = $params['period'] ?? Carbon::now('UTC')->format('Y-m');
        $dryRun = (bool) ($params['dryRun'] ?? false);
        $cycleId = "CYCLE-" . str_replace('-', '', $period);
        $startedAt = Carbon::now('UTC');

        $billingCfg = $this->getBillingConfig();
        $dueDate = $this->dueDateForPeriod($period, $billingCfg['dueDay']);

        $lockKey = crc32("billing_cycle_{$period}");
        $lockAcquired = false;

        if (!$dryRun) {
            $lockRow = DB::selectOne("SELECT pg_try_advisory_lock(?) AS locked", [$lockKey]);
            if (!($lockRow->locked ?? false)) {
                return [
                    'success' => true,
                    'cycleId' => $cycleId,
                    'period' => $period,
                    'dryRun' => false,
                    'invoiceCount' => 0,
                    'createdCount' => 0,
                    'totalAmount' => 0.00,
                    'failures' => [],
                    'skipped' => [],
                    'dueDate' => $dueDate,
                    'reason' => 'another_cycle_is_running',
                ];
            }
            $lockAcquired = true;

            $alreadyCompleted = BillingCycle::where('period', $period)->where('status', 'completed')->first();
            if ($alreadyCompleted) {
                return [
                    'success' => true,
                    'cycleId' => $alreadyCompleted->id,
                    'period' => $period,
                    'dryRun' => false,
                    'invoiceCount' => (int) $alreadyCompleted->invoice_count,
                    'createdCount' => 0,
                    'totalAmount' => (float) $alreadyCompleted->total_amount,
                    'failures' => [],
                    'skipped' => [['reason' => 'cycle_already_completed']],
                    'dueDate' => $dueDate,
                    'reason' => 'cycle_already_completed',
                ];
            }
        }

        try {
            $subscribers = Subscriber::whereIn('status', ['active', 'pending'])
                ->with('package')
                ->orderBy('id')
                ->get();

            $invoiceCount = 0;
            $createdCount = 0;
            $totalAmountCents = 0;
            $failures = [];
            $skipped = [];

            if (!$dryRun) {
                BillingCycle::updateOrCreate(
                    ['period' => $period],
                    ['id' => $cycleId, 'status' => 'running', 'started_at' => $startedAt]
                );
            }

        foreach ($subscribers as $subscriber) {
            $packageId = $subscriber->package_id;
            if (!$packageId) {
                $skipped[] = ['subscriberId' => $subscriber->id, 'reason' => 'no_package_assigned'];
                continue;
            }

            $package = $subscriber->package ?? Package::find($packageId);
            if (!$package) {
                $failures[] = ['subscriberId' => $subscriber->id, 'reason' => 'package_not_found'];
                continue;
            }

            $packagePriceCents = self::toCents($package->price);
            if ($packagePriceCents === 0) {
                $skipped[] = ['subscriberId' => $subscriber->id, 'reason' => 'zero_price_package'];
                continue;
            }

            // Check if invoice already exists for this subscriber and period
            $existingInvoice = Invoice::where('subscriber_id', $subscriber->id)
                ->whereRaw("COALESCE(raw_data->>'period', '') = ?", [$period])
                ->first();

            if ($existingInvoice) {
                $skipped[] = ['subscriberId' => $subscriber->id, 'reason' => 'invoice_already_exists', 'invoiceId' => $existingInvoice->id];
                $invoiceCount++;
                $totalAmountCents += self::toCents($existingInvoice->amount);
                continue;
            }

            if ($dryRun) {
                $invoiceCount++;
                $totalAmountCents += $packagePriceCents;
                continue;
            }

            try {
                $result = DB::transaction(function () use (
                    $subscriber,
                    $package,
                    $packagePriceCents,
                    $period,
                    $dueDate,
                    $billingCfg
                ) {
                    $invoiceId = "INV-" . str_replace('-', '', $period) . "-{$subscriber->id}";

                    // Check duplicate inside transaction with lock
                    $existing = Invoice::where('id', $invoiceId)
                        ->orWhere(function ($q) use ($subscriber, $period) {
                            $q->where('subscriber_id', $subscriber->id)
                              ->whereRaw("COALESCE(raw_data->>'period', '') = ?", [$period]);
                        })
                        ->lockForUpdate()
                        ->first();
                    if ($existing) {
                        return ['created' => false, 'invoice' => $existing, 'amountCents' => 0];
                    }

                    // Check prior unpaid invoices for this subscriber
                    $priorUnpaid = Invoice::where('subscriber_id', $subscriber->id)
                        ->where('status', 'unpaid')
                        ->where('id', '<>', $invoiceId)
                        ->whereRaw("COALESCE(raw_data->>'period', '') < ?", [$period])
                        ->orderByRaw("COALESCE(raw_data->>'period', due_date, '') ASC")
                        ->get();

                    $carriedOverCents = 0;
                    $lateFeeCents = 0;
                    $carriedInvoiceIds = [];
                    $carriedPeriods = [];
                    $lateFeeInvoiceIds = [];
                    $lateFeePeriods = [];

                    foreach ($priorUnpaid as $prevInv) {
                        $prevRaw = $prevInv->raw_data ?? [];
                        if (empty($prevRaw['carriedIntoInvoiceId'])) {
                            $prevAmtCents = self::toCents($prevInv->amount);
                            if ($prevAmtCents > 0) {
                                $carriedOverCents += $prevAmtCents;
                                $carriedInvoiceIds[] = $prevInv->id;
                                $carriedPeriods[] = $prevRaw['period'] ?? $prevInv->id;
                            }
                        }

                        $alreadyApplied = (bool) ($prevInv->late_fee_applied || ($prevRaw['lateFeeApplied'] ?? false));
                        if (!$alreadyApplied) {
                            $feeForMissedMonth = $this->calculateLateFeeCents($packagePriceCents, $billingCfg);
                            if ($feeForMissedMonth > 0) {
                                $lateFeeCents += $feeForMissedMonth;
                                $lateFeeInvoiceIds[] = $prevInv->id;
                                $lateFeePeriods[] = $prevRaw['period'] ?? $prevInv->id;
                            }
                        }
                    }

                    $lines = [
                        [
                            'code' => 'subscription',
                            'type' => 'subscription',
                            'description' => "{$package->name} — Monthly Subscription ({$period})",
                            'amountCents' => $packagePriceCents,
                            'amount' => self::fromCents($packagePriceCents),
                        ],
                    ];

                    if ($carriedOverCents > 0) {
                        $lines[] = [
                            'code' => 'carried_forward',
                            'type' => 'carried_over',
                            'description' => 'Carried-Over Unpaid Balance (' . implode(', ', $carriedPeriods) . ')',
                            'amountCents' => $carriedOverCents,
                            'amount' => self::fromCents($carriedOverCents),
                            'sourceInvoices' => $carriedInvoiceIds,
                        ];
                    }

                    if ($lateFeeCents > 0) {
                        $lines[] = [
                            'code' => 'late_fee',
                            'type' => 'late_fee',
                            'description' => "Late Fee ({$billingCfg['lateFeePercent']}% on \${$package->price} plan for " . implode(', ', $lateFeePeriods) . ")",
                            'amountCents' => $lateFeeCents,
                            'amount' => self::fromCents($lateFeeCents),
                            'sourceInvoices' => $lateFeeInvoiceIds,
                        ];
                    }

                    $invoiceTotalCents = $packagePriceCents + $carriedOverCents + $lateFeeCents;
                    $invoiceAmount = self::fromCents($invoiceTotalCents);
                    $carriedOverAmount = self::fromCents($carriedOverCents);
                    $lateFee = self::fromCents($lateFeeCents);

                    $rawData = [
                        'period' => $period,
                        'invoiceNumber' => $invoiceId,
                        'subscriberId' => $subscriber->id,
                        'subscriberName' => $subscriber->name,
                        'subscriberPhone' => $subscriber->phone,
                        'packageId' => $package->id,
                        'packageName' => $package->name,
                        'packagePrice' => (float) $package->price,
                        'amount' => $invoiceAmount,
                        'amountCents' => $invoiceTotalCents,
                        'subscriptionAmount' => (float) $package->price,
                        'subscriptionAmountCents' => $packagePriceCents,
                        'carriedOverAmount' => $carriedOverAmount,
                        'carriedOverCents' => $carriedOverCents,
                        'carriedFromInvoices' => $carriedInvoiceIds,
                        'carriedFromPeriods' => $carriedPeriods,
                        'lateFee' => $lateFee,
                        'lateFeeCents' => $lateFeeCents,
                        'lateFeePercent' => $billingCfg['lateFeePercent'],
                        'lateFeeFromInvoices' => $lateFeeInvoiceIds,
                        'lateFeeFromPeriods' => $lateFeePeriods,
                        'lines' => $lines,
                        'currency' => $billingCfg['currency'],
                        'dueDate' => $dueDate,
                        'status' => 'unpaid',
                        'generatedBy' => 'billing-engine',
                        'generatedAt' => Carbon::now('UTC')->toIso8601String(),
                    ];

                    $createdInvoice = Invoice::create([
                        'id' => $invoiceId,
                        'subscriber_id' => $subscriber->id,
                        'amount' => $invoiceAmount,
                        'installation_fee' => 0.00,
                        'tax_fee' => 0.00,
                        'late_fee' => $lateFee,
                        'carried_over_amount' => $carriedOverAmount,
                        'late_fee_applied' => false,
                        'status' => 'unpaid',
                        'due_date' => $dueDate,
                        'raw_data' => $rawData,
                    ]);

                    // Update prior unpaid invoices marked carried
                    foreach ($priorUnpaid as $prevInv) {
                        $wasCarried = in_array($prevInv->id, $carriedInvoiceIds);
                        $hadLateFee = in_array($prevInv->id, $lateFeeInvoiceIds);
                        if ($wasCarried || $hadLateFee) {
                            $patch = array_merge($prevInv->raw_data ?? [], [
                                'lateFeeApplied' => (bool) ($prevInv->late_fee_applied || ($prevInv->raw_data['lateFeeApplied'] ?? false) || $hadLateFee),
                            ]);
                            if ($hadLateFee) {
                                $patch['lateFeeAppliedInInvoice'] = $invoiceId;
                                $patch['lateFeeAppliedInPeriod'] = $period;
                            }
                            if ($wasCarried) {
                                $patch['status'] = 'carried_forward';
                                $patch['carriedIntoInvoiceId'] = $invoiceId;
                                $patch['carriedIntoPeriod'] = $period;
                                $patch['carriedForwardAt'] = Carbon::now('UTC')->toIso8601String();
                            }

                            $updateData = ['raw_data' => $patch];
                            if ($wasCarried) {
                                $updateData['status'] = 'carried_forward';
                            }
                            if ($hadLateFee) {
                                $updateData['late_fee_applied'] = true;
                            }
                            $prevInv->update($updateData);
                        }
                    }

                    // Log billing event
                    BillingEvent::create([
                        'subscriber_id' => $subscriber->id,
                        'invoice_id' => $invoiceId,
                        'event' => 'invoice_generated',
                        'amount' => $invoiceAmount,
                        'message' => "Invoice {$invoiceId} generated for {$period} (\${$invoiceAmount})",
                        'raw_data' => ['period' => $period, 'lines' => $lines],
                    ]);

                    SubscriberBilling::updateOrCreate(
                        ['subscriber_id' => $subscriber->id],
                        ['last_invoice_id' => $invoiceId, 'updated_at' => Carbon::now('UTC')]
                    );

                    return ['created' => true, 'invoice' => $createdInvoice, 'amountCents' => $invoiceTotalCents];
                });

                if ($result['created']) {
                    $createdCount++;
                    $invoiceCount++;
                    $totalAmountCents += $result['amountCents'];
                }
            } catch (\Throwable $e) {
                Log::error('billing cycle invoice generation error', [
                    'subscriberId' => $subscriber->id,
                    'error' => $e->getMessage(),
                ]);
                $failures[] = ['subscriberId' => $subscriber->id, 'error' => $e->getMessage()];
            }
        }

        $totalAmount = self::fromCents($totalAmountCents);

        if (!$dryRun) {
            BillingCycle::where('period', $period)->update([
                'status' => 'completed',
                'invoice_count' => $invoiceCount,
                'total_amount' => $totalAmount,
                'collected_amount' => 0.00,
                'details' => [
                    'createdCount' => $createdCount,
                    'failures' => $failures,
                    'skipped' => $skipped,
                ],
                'completed_at' => Carbon::now('UTC'),
            ]);
        }

        return [
            'success' => true,
            'cycleId' => $cycleId,
            'period' => $period,
            'dryRun' => $dryRun,
            'invoiceCount' => $invoiceCount,
            'createdCount' => $createdCount,
            'totalAmount' => $totalAmount,
            'failures' => $failures,
            'skipped' => $skipped,
            'dueDate' => $dueDate,
        ];
        } finally {
            if ($lockAcquired) {
                try {
                    DB::statement("SELECT pg_advisory_unlock(?)", [$lockKey]);
                } catch (\Throwable $ignored) {}
            }
        }
    }

    /**
     * Overview aggregate statistics for admin dashboard
     */
    public function getOverview(): array
    {
        $totalsRow = DB::selectOne("
            SELECT
                COUNT(*) FILTER (WHERE status = 'unpaid')::int                          AS unpaid_count,
                COALESCE(SUM(amount) FILTER (WHERE status = 'unpaid'), 0)::numeric       AS unpaid_amount,
                COUNT(*) FILTER (WHERE status = 'paid')::int                            AS paid_count,
                COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0)::numeric         AS paid_amount,
                COALESCE(SUM(installation_fee), 0)::numeric                             AS total_installation_fees,
                COALESCE(SUM(tax_fee), 0)::numeric                                      AS total_tax_fees,
                COALESCE(SUM(late_fee), 0)::numeric                                     AS total_late_fees,
                COALESCE(SUM(amount) FILTER (WHERE status <> 'carried_forward'), 0)::numeric AS total_amount,
                COUNT(*)::int                                                           AS total_count
            FROM invoices
        ");

        $totals = [
            'unpaid_count' => (int) ($totalsRow->unpaid_count ?? 0),
            'unpaid_amount' => (float) ($totalsRow->unpaid_amount ?? 0),
            'paid_count' => (int) ($totalsRow->paid_count ?? 0),
            'paid_amount' => (float) ($totalsRow->paid_amount ?? 0),
            'total_installation_fees' => (float) ($totalsRow->total_installation_fees ?? 0),
            'total_tax_fees' => (float) ($totalsRow->total_tax_fees ?? 0),
            'total_late_fees' => (float) ($totalsRow->total_late_fees ?? 0),
            'total_amount' => (float) ($totalsRow->total_amount ?? 0),
            'total_count' => (int) ($totalsRow->total_count ?? 0),
        ];

        $cycles = BillingCycle::orderBy('started_at', 'desc')->take(12)->get();

        $overdueCountRow = DB::selectOne("
            SELECT COUNT(*)::int AS count
            FROM invoices
            WHERE status = 'unpaid'
              AND due_date IS NOT NULL
              AND due_date <> ''
              AND (
                CASE WHEN due_date ~ '^\\d{4}-\\d{2}-\\d{2}'
                     THEN due_date::date < CURRENT_DATE
                     ELSE FALSE
                END
              )
        ");
        $overdueCount = (int) ($overdueCountRow->count ?? 0);

        $recentEvents = BillingEvent::orderBy('created_at', 'desc')->take(20)->get();

        return [
            'totals' => $totals,
            'cycles' => $cycles,
            'overdueCount' => $overdueCount,
            'recentEvents' => $recentEvents,
        ];
    }

    /**
     * Auto-disconnect subscribers whose bill is past the grace period
     */
    public function autoSuspendOverdue(): array
    {
        $billingCfg = $this->getBillingConfig();
        $suspendAfterDays = $billingCfg['suspendAfterDays'];

        $overdueInvoices = DB::select("
            SELECT i.*
            FROM invoices i
            JOIN subscribers s ON s.id = i.subscriber_id
            WHERE i.status = 'unpaid'
              AND s.status = 'active'
              AND i.due_date IS NOT NULL
              AND i.due_date <> ''
              AND (
                CASE WHEN i.due_date ~ '^\\d{4}-\\d{2}-\\d{2}'
                     THEN i.due_date::date + (?::int * INTERVAL '1 day') < CURRENT_DATE
                     ELSE FALSE
                END
              )
        ", [$suspendAfterDays]);

        $bySubscriber = [];
        foreach ($overdueInvoices as $inv) {
            $bySubscriber[$inv->subscriber_id][] = $inv;
        }

        $results = [];

        foreach ($bySubscriber as $subscriberId => $invoices) {
            $subscriber = Subscriber::find($subscriberId);
            if (!$subscriber) continue;

            if (in_array($subscriber->status, ['suspended', 'disconnected'])) {
                foreach ($invoices as $inv) {
                    $results[] = [
                        'subscriberId' => $subscriberId,
                        'invoiceId' => $inv->id,
                        'status' => 'already_suspended',
                    ];
                }
                continue;
            }

            $invoiceIds = implode(', ', array_map(fn ($i) => $i->id, $invoices));

            DB::transaction(function () use ($subscriber, $invoices, $invoiceIds) {
                $subscriber->update([
                    'status' => 'suspended',
                    'raw_data' => array_merge($subscriber->raw_data ?? [], ['status' => 'suspended']),
                ]);

                SubscriberBilling::where('subscriber_id', $subscriber->id)->update([
                    'status' => 'suspended',
                    'updated_at' => Carbon::now('UTC'),
                ]);

                foreach ($invoices as $inv) {
                    BillingEvent::create([
                        'subscriber_id' => $subscriber->id,
                        'invoice_id' => $inv->id,
                        'event' => 'auto_suspended',
                        'amount' => (float) $inv->amount,
                        'message' => "Service auto-suspended for unpaid invoice (outstanding: {$invoiceIds})",
                    ]);
                }
            });

            foreach ($invoices as $inv) {
                $results[] = [
                    'subscriberId' => $subscriber->id,
                    'invoiceId' => $inv->id,
                    'status' => 'suspended',
                ];
            }
        }

        return [
            'processed' => count($results),
            'results' => $results,
        ];
    }
}
