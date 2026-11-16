<?php

namespace App\Services;

use App\Models\AuditLog;
use App\Models\BillingEvent;
use App\Models\Invoice;
use App\Models\Order;
use App\Models\PaymentTransaction;
use App\Models\Subscriber;
use App\Models\SubscriberBilling;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class PaymentSettlementService
{
    /**
     * Settle payment atomically with strict database isolation and row-level locking
     */
    public function applyPayment(array $params): array
    {
        $invoiceId = $params['invoiceId'] ?? '';
        $transactionId = $params['transactionId'] ?? '';
        $gateway = $params['gateway'] ?? 'mock';
        $amount = isset($params['amount']) ? (float) $params['amount'] : null;
        $raw = $params['raw'] ?? [];

        // Server-side database safety guard
        $connectionName = DB::getDefaultConnection();
        $databaseName = DB::connection()->getDatabaseName();
        if (app()->environment() !== 'production' && $databaseName !== 'nextlink_test_db') {
            throw new \RuntimeException(
                "CRITICAL ISOLATION HALT: Attempted payment settlement write to '{$databaseName}' instead of 'nextlink_test_db'!"
            );
        }

        return DB::transaction(function () use ($invoiceId, $transactionId, $gateway, $amount, $raw) {
            $invoice = Invoice::where('id', $invoiceId)->lockForUpdate()->first();
            if (!$invoice) {
                $err = new \RuntimeException("Invoice not found: {$invoiceId}");
                throw $err;
            }

            if ($invoice->status === 'paid') {
                return ['invoice' => $invoice, 'alreadyPaid' => true];
            }

            $expectedCents = (int) round(((float) $invoice->amount) * 100);
            $settledCents = $amount !== null ? (int) round(((float) $amount) * 100) : $expectedCents;
            $settledAmount = round($settledCents / 100, 2);

            if ($expectedCents > 0 && ($settledCents + 1) < $expectedCents) {
                throw new \RuntimeException(
                    "The settled amount (\${$settledAmount}) does not cover the invoice (\${$invoice->amount})"
                );
            }

            $paidAt = Carbon::now('UTC')->toIso8601String();
            $invoiceRaw = is_array($invoice->raw_data) ? $invoice->raw_data : [];

            // 1. Update invoice to paid
            $invoice->status = 'paid';
            $invoice->raw_data = array_merge($invoiceRaw, [
                'status' => 'paid',
                'paidAt' => $paidAt,
                'paidVia' => $gateway,
                'transactionId' => $transactionId,
                'paidAmount' => $settledAmount,
            ]);
            $invoice->updated_at = Carbon::now('UTC');
            $invoice->save();

            // 2. Also settle prior carried_forward invoices rolled into this period
            if ($invoice->subscriber_id) {
                $carriedInvoices = Invoice::where('subscriber_id', $invoice->subscriber_id)
                    ->where('status', 'carried_forward')
                    ->lockForUpdate()
                    ->get();

                foreach ($carriedInvoices as $carried) {
                    $cRaw = is_array($carried->raw_data) ? $carried->raw_data : [];
                    $carried->status = 'paid';
                    $carried->raw_data = array_merge($cRaw, [
                        'status' => 'paid',
                        'paidAt' => $paidAt,
                        'paidVia' => $gateway,
                        'settledByInvoiceId' => $invoiceId,
                        'transactionId' => $transactionId,
                    ]);
                    $carried->updated_at = Carbon::now('UTC');
                    $carried->save();
                }
            }

            // 3. Update subscriber service status and dates
            $subscriber = null;
            if ($invoice->subscriber_id) {
                $subscriber = Subscriber::where('id', $invoice->subscriber_id)->lockForUpdate()->first();
            }

            if ($subscriber) {
                $isFirstPurchase = ($subscriber->status === 'registered');

                $outstandingCount = Invoice::where('subscriber_id', $subscriber->id)
                    ->where('status', 'unpaid')
                    ->count();

                if ($outstandingCount === 0 && !$isFirstPurchase) {
                    if ($subscriber->status !== 'active') {
                        $subRaw = is_array($subscriber->raw_data) ? $subscriber->raw_data : [];
                        $subscriber->status = 'active';
                        $subscriber->raw_data = array_merge($subRaw, ['status' => 'active']);
                        $subscriber->updated_at = Carbon::now('UTC');
                        $subscriber->save();

                        SubscriberBilling::where('subscriber_id', $subscriber->id)
                            ->update(['status' => 'active', 'updated_at' => Carbon::now('UTC')]);

                        BillingEvent::create([
                            'subscriber_id' => $subscriber->id,
                            'invoice_id' => $invoiceId,
                            'event' => 'service_restored',
                            'amount' => $settledAmount,
                            'message' => 'Service restored after payment',
                            'created_at' => Carbon::now('UTC'),
                        ]);
                    }
                } elseif ($outstandingCount > 0) {
                    BillingEvent::create([
                        'subscriber_id' => $subscriber->id,
                        'invoice_id' => $invoiceId,
                        'event' => 'payment_received_outstanding',
                        'amount' => $settledAmount,
                        'message' => "Payment received, but {$outstandingCount} invoice(s) are still unpaid — service stays suspended",
                        'created_at' => Carbon::now('UTC'),
                    ]);
                }

                // If registered, activate subscription
                if ($isFirstPurchase) {
                    $subRaw = is_array($subscriber->raw_data) ? $subscriber->raw_data : [];
                    $subscriber->status = 'active';
                    $subscriber->raw_data = array_merge($subRaw, [
                        'status' => 'active',
                        'subscriptionStartedAt' => $paidAt,
                    ]);
                    $subscriber->updated_at = Carbon::now('UTC');
                    $subscriber->save();

                    SubscriberBilling::where('subscriber_id', $subscriber->id)
                        ->update(['status' => 'active', 'updated_at' => Carbon::now('UTC')]);
                }

                // Advance subscriber dueDate and nextBillingDate
                try {
                    $billingPeriod = $invoiceRaw['period'] ?? Carbon::now('UTC')->format('Y-m');
                    $periodParts = explode('-', $billingPeriod);
                    $pYear = (int) ($periodParts[0] ?? date('Y'));
                    $pMonth = (int) ($periodParts[1] ?? date('m'));

                    $nextCycleDate = Carbon::createFromDate($pYear, $pMonth, 1, 'UTC')->addMonth();
                    $nextCyclePeriod = $nextCycleDate->format('Y-m');
                    $nextCycleDueDate = "{$nextCyclePeriod}-10";

                    $subRaw = is_array($subscriber->raw_data) ? $subscriber->raw_data : [];
                    $subscriber->raw_data = array_merge($subRaw, [
                        'dueDate' => $nextCycleDueDate,
                        'nextBillingDate' => $nextCycleDueDate,
                    ]);
                    $subscriber->updated_at = Carbon::now('UTC');
                    $subscriber->save();
                } catch (\Throwable $dueErr) {
                    Log::warning('Failed to advance subscriber dueDate:', ['error' => $dueErr->getMessage()]);
                }
            }

            // 4. Update related Order if orderId exists
            $orderId = $invoiceRaw['orderId'] ?? null;
            if ($orderId) {
                Order::where('id', $orderId)->update([
                    'payment_status' => 'Payment Verified',
                    'trx_id' => $transactionId,
                    'updated_at' => Carbon::now('UTC'),
                ]);
            }

            // 5. Record primary billing event
            BillingEvent::create([
                'subscriber_id' => $invoice->subscriber_id,
                'invoice_id' => $invoiceId,
                'event' => 'payment_received',
                'amount' => $settledAmount,
                'message' => "Payment via {$gateway} ({$transactionId})",
                'created_at' => Carbon::now('UTC'),
            ]);

            // 6. Record audit log
            AuditLog::create([
                'actor_id' => $invoice->subscriber_id ?: 'system',
                'actor_role' => 'subscriber',
                'action' => 'payment.settled',
                'entity_type' => 'invoice',
                'entity_id' => $invoiceId,
                'details' => [
                    'gateway' => $gateway,
                    'transactionId' => $transactionId,
                    'amount' => $settledAmount,
                ],
                'ip_address' => request()->ip() ?? '127.0.0.1',
            ]);

            return ['invoice' => $invoice, 'alreadyPaid' => false];
        });
    }
}

