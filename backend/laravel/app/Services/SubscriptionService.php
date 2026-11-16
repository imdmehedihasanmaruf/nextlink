<?php

namespace App\Services;

use App\Models\BillingEvent;
use App\Models\Cancellation;
use App\Models\Invoice;
use App\Models\Order;
use App\Models\Package;
use App\Models\Subscriber;
use App\Models\SubscriberBilling;
use Illuminate\Support\Facades\DB;

class SubscriptionService
{
    /**
     * Get subscriber subscription status matching Express services/subscriptions/index.js.
     */
    public function getSubscription(string $subscriberId): ?array
    {
        $subscriber = Subscriber::find($subscriberId);
        if (!$subscriber) {
            return null;
        }

        $package = $subscriber->package_id ? Package::find($subscriber->package_id) : null;
        $billing = SubscriberBilling::where('subscriber_id', $subscriber->id)->first();
        $raw = is_array($subscriber->raw_data) ? $subscriber->raw_data : [];

        $invoices = Invoice::where('subscriber_id', $subscriber->id)
            ->orderBy('created_at', 'desc')
            ->limit(25)
            ->get();

        $lastOrder = Order::where('customer_id', $subscriber->id)
            ->orderBy('created_at', 'desc')
            ->first();

        $lastPurchase = $lastOrder ? [
            'orderId' => $lastOrder->id,
            'packageId' => $lastOrder->package_id,
            'packageName' => $lastOrder->package_name,
            'amount' => (float) $lastOrder->total_payable,
            'status' => $lastOrder->order_status,
            'createdAt' => $lastOrder->created_at ? $lastOrder->created_at->toIso8601String() : null,
        ] : null;

        $startedAt = $raw['subscriptionStartedAt']
            ?? ($subscriber->created_at ? $subscriber->created_at->toIso8601String() : null);
        $cancelledAt = $raw['subscriptionCancelledAt'] ?? null;

        return [
            'status' => $subscriber->status,
            'isSubscriber' => strtolower((string) $subscriber->status) === 'active',
            'packageId' => $subscriber->package_id,
            'packageName' => $package ? $package->name : ($raw['packageName'] ?? ''),
            'packagePrice' => $package ? (float) $package->price : (float) ($raw['price'] ?? 0),
            'subscriptionStartedAt' => $startedAt,
            'subscriptionCancelledAt' => $cancelledAt,
            'billingProfile' => $billing,
            'lastPurchase' => $lastPurchase,
            'invoices' => $invoices,
            'canCancel' => strtolower((string) $subscriber->status) === 'active',
        ];
    }

    /**
     * Activate subscription after package purchase inside a DB transaction.
     */
    public function activateAfterPurchase(array $params): array
    {
        $subscriberId = $params['subscriberId'];
        $packageId = $params['packageId'];

        $subscriber = Subscriber::findOrFail($subscriberId);
        $package = Package::findOrFail($packageId);

        if (strtolower((string) $subscriber->status) === 'cancelled') {
            throw new \RuntimeException('This subscription was cancelled. Purchase a plan to start a new subscription.');
        }

        $alreadyActive = strtolower((string) $subscriber->status) === 'active'
            && $subscriber->package_id === $packageId;

        $startedAt = now()->toIso8601String();

        DB::transaction(function () use ($subscriber, $package, $packageId, $startedAt, $params) {
            $raw = is_array($subscriber->raw_data) ? $subscriber->raw_data : [];
            $raw['packageName'] = $package->name;
            $raw['packagePrice'] = (float) $package->price;
            $raw['subscriptionStartedAt'] = $startedAt;

            $subscriber->status = 'active';
            $subscriber->package_id = $packageId;
            $subscriber->raw_data = $raw;
            $subscriber->save();

            SubscriberBilling::updateOrCreate(
                ['subscriber_id' => $subscriber->id],
                [
                    'package_id' => $packageId,
                    'amount' => (float) $package->price,
                    'currency' => 'USD',
                    'billing_start' => date('Y-m-01'),
                    'billing_end' => date('Y-m-t'),
                    'next_invoice_date' => date('Y-m-01', strtotime('+1 month')),
                    'auto_disconnect' => true,
                    'status' => 'active',
                ]
            );

            BillingEvent::create([
                'subscriber_id' => $subscriber->id,
                'event' => 'subscription.activated',
                'amount' => (float) $package->price,
                'message' => "Subscription activated for package {$package->name}",
                'raw_data' => [
                    'packageId' => $packageId,
                    'packageName' => $package->name,
                    'orderId' => $params['orderId'] ?? null,
                ],
                'created_at' => now(),
            ]);
        });

        return [
            'alreadyActive' => $alreadyActive,
            'startedAt' => $startedAt,
            'provisioning' => [
                'attempted' => true,
                'success' => true,
                'mode' => env('MIKROTIK_MODE', 'simulator'),
            ],
        ];
    }

    /**
     * Change package for subscriber inside a DB transaction.
     */
    public function changePackage(string $subscriberId, string $newPackageId): array
    {
        $subscriber = Subscriber::findOrFail($subscriberId);
        $package = Package::findOrFail($newPackageId);

        $oldPackageId = $subscriber->package_id;

        DB::transaction(function () use ($subscriber, $package, $oldPackageId, $newPackageId) {
            $raw = is_array($subscriber->raw_data) ? $subscriber->raw_data : [];
            $raw['packageName'] = $package->name;
            $raw['packagePrice'] = (float) $package->price;

            $subscriber->package_id = $newPackageId;
            $subscriber->raw_data = $raw;
            $subscriber->save();

            SubscriberBilling::updateOrCreate(
                ['subscriber_id' => $subscriber->id],
                [
                    'package_id' => $newPackageId,
                    'amount' => (float) $package->price,
                ]
            );

            BillingEvent::create([
                'subscriber_id' => $subscriber->id,
                'event' => 'subscription.package_changed',
                'amount' => (float) $package->price,
                'message' => "Package changed from {$oldPackageId} to {$newPackageId}",
                'raw_data' => [
                    'oldPackageId' => $oldPackageId,
                    'newPackageId' => $newPackageId,
                    'packageName' => $package->name,
                ],
                'created_at' => now(),
            ]);
        });

        return [
            'success' => true,
            'packageId' => $newPackageId,
            'packageName' => $package->name,
            'packagePrice' => (float) $package->price,
        ];
    }
}
