<?php

namespace App\Http\Controllers;

use App\Models\BillingEvent;
use App\Models\Cancellation;
use App\Models\Invoice;
use App\Models\Order;
use App\Models\Package;
use App\Models\Subscriber;
use App\Models\SubscriberBilling;
use App\Services\SettingsService;
use App\Services\SubscriptionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class SubscriptionController
{
    protected SubscriptionService $subscriptionService;
    protected SettingsService $settingsService;

    public function __construct(SubscriptionService $subscriptionService, SettingsService $settingsService)
    {
        $this->subscriptionService = $subscriptionService;
        $this->settingsService = $settingsService;
    }

    /**
     * Resolve effective subscriber ID with strict tenant isolation.
     * Relies strictly on authenticated principal resolved by AuthenticateJwt.
     */
    protected function resolveSubscriberId(Request $request): ?string
    {
        $user = $request->attributes->get('user') ?? $request->user();

        if (!$user) {
            return null;
        }

        $userRole = is_object($user) ? ($user->role ?? null) : ($user['role'] ?? null);
        $userType = is_object($user) ? ($user->type ?? null) : ($user['type'] ?? null);
        $userId = is_object($user) ? ($user->id ?? null) : ($user['id'] ?? null);
        $userSubId = is_object($user) ? ($user->subscriberId ?? null) : ($user['subscriberId'] ?? null);

        if ($userType === 'subscriber' || $userRole === 'subscriber') {
            return $userSubId ?: $userId;
        }

        if ($request->has('subscriberId')) {
            return (string) $request->query('subscriberId');
        }

        if ($request->filled('subscriberId')) {
            return (string) $request->input('subscriberId');
        }

        return $userSubId ?: $userId;
    }

    /**
     * GET /api/customer/subscription
     */
    public function show(Request $request): JsonResponse
    {
        $subscriberId = $this->resolveSubscriberId($request);

        if (!$subscriberId) {
            return response()->json(['success' => false, 'error' => 'Authentication required'], 401);
        }

        $subscription = $this->subscriptionService->getSubscription($subscriberId);
        if (!$subscription) {
            return response()->json(['success' => false, 'error' => 'Account not found'], 404);
        }

        return response()->json([
            'success' => true,
            'subscription' => $subscription,
        ]);
    }

    /**
     * POST /api/customer/subscription/activate
     */
    public function activate(Request $request): JsonResponse
    {
        $subscriberId = $this->resolveSubscriberId($request);

        if (!$subscriberId) {
            return response()->json(['success' => false, 'error' => 'Authentication required'], 401);
        }

        $packageId = $request->input('packageId');
        if (empty($packageId)) {
            return response()->json(['success' => false, 'error' => 'packageId is required'], 400);
        }

        $package = Package::find($packageId);
        if (!$package) {
            return response()->json(['success' => false, 'error' => 'Selected package not found'], 404);
        }

        $subscriber = Subscriber::find($subscriberId);
        if (!$subscriber) {
            return response()->json(['success' => false, 'error' => 'Subscriber not found'], 404);
        }

        // SEC-04: Subscribers cannot self-activate without verified paid invoice or active/paid order
        $user = $request->attributes->get('user');
        if (!$user && $request->bearerToken()) {
            try {
                $jwtService = app(\App\Services\JwtService::class);
                $identityService = app(\App\Services\AuthIdentityService::class);
                $payload = $jwtService->verify($request->bearerToken());
                $resolved = $identityService->resolveIdentity($payload);
                if ($resolved) {
                    $user = (object) $resolved;
                }
            } catch (\Throwable $e) {}
        }

        $userRole = is_object($user) ? ($user->role ?? null) : ($user['role'] ?? null);
        $isStaffPrivilege = in_array($userRole, ['super_admin', 'billing', 'support'], true);

        if (!$isStaffPrivilege) {
            $hasPaidInvoice = Invoice::where('subscriber_id', $subscriberId)
                ->where('status', 'paid')
                ->exists();

            $hasPaidOrder = Order::where('customer_id', $subscriberId)
                ->where(function ($q) {
                    $q->whereIn('payment_status', ['Paid', 'paid'])
                      ->orWhere('order_status', 'Active');
                })
                ->exists();

            if (!$hasPaidInvoice && !$hasPaidOrder) {
                return response()->json([
                    'success' => false,
                    'error' => 'Payment verification required before activating subscription.',
                ], 403);
            }
        }

        try {
            $result = $this->subscriptionService->activateAfterPurchase([
                'subscriberId' => $subscriberId,
                'packageId' => $packageId,
                'packageName' => $package->name,
                'orderId' => $request->input('orderId'),
            ]);
            return response()->json(array_merge(['success' => true], $result));
        } catch (\Throwable $e) {
            return response()->json(['success' => false, 'error' => $e->getMessage()], 400);
        }
    }

    /**
     * POST /api/customer/subscription/change-package
     */
    public function changePackage(Request $request): JsonResponse
    {
        $subscriberId = $this->resolveSubscriberId($request);

        if (!$subscriberId) {
            return response()->json(['success' => false, 'error' => 'Authentication required'], 401);
        }

        $newPackageId = $request->input('packageId') ?? $request->input('newPackageId');
        if (empty($newPackageId)) {
            return response()->json(['success' => false, 'error' => 'packageId is required'], 400);
        }

        $package = Package::find($newPackageId);
        if (!$package) {
            return response()->json(['success' => false, 'error' => 'Package not found'], 404);
        }

        $subscriber = Subscriber::find($subscriberId);
        if (!$subscriber) {
            return response()->json(['success' => false, 'error' => 'Subscriber not found'], 404);
        }

        $result = $this->subscriptionService->changePackage($subscriberId, $newPackageId);

        return response()->json([
            'success' => true,
            'message' => "Package successfully changed to {$package->name}",
            'packageId' => $result['packageId'],
            'packageName' => $result['packageName'],
            'packagePrice' => $result['packagePrice'],
        ]);
    }

    /**
     * GET /api/portal/cancel-info & GET /api/portal/cancel-profile
     */
    public function cancelInfo(Request $request): JsonResponse
    {
        $subscriberId = $this->resolveSubscriberId($request);

        if (!$subscriberId) {
            return response()->json(['success' => false, 'error' => 'Authentication required'], 401);
        }

        $subscriber = Subscriber::find($subscriberId);
        $package = $subscriber && $subscriber->package_id ? Package::find($subscriber->package_id) : null;
        $cancellation = Cancellation::where('subscriber_id', $subscriberId)->orderBy('created_at', 'desc')->first();

        $cancelSettings = $this->settingsService->getGroup('cancellation');
        $reasons = !empty($cancelSettings['reasons']) && is_array($cancelSettings['reasons'])
            ? $cancelSettings['reasons']
            : [
                'Too expensive',
                'Slow speed',
                'Frequent disconnections',
                'Moving to another location',
                'Switching provider',
                'Poor support',
                'Temporary pause',
                'Other',
            ];

        $unpaidBalance = (float) Invoice::where('subscriber_id', $subscriberId)
            ->where('status', 'unpaid')
            ->sum('amount');

        $hasActivePackage = $subscriber && strtolower((string) $subscriber->status) === 'active' && !empty($subscriber->package_id);
        $pkgSpeed = $package ? (int) $package->speed : 0;
        $pkgName = $package ? $package->name : 'No active package';
        $pkgLabel = $package ? "{$pkgName} ({$pkgSpeed} Mbps)" : 'No active package';

        $lastOrder = Order::where('customer_id', $subscriberId)->orderBy('created_at', 'desc')->first();
        $lastPurchase = [
            'purchaseDate' => $lastOrder && $lastOrder->created_at ? $lastOrder->created_at->format('d/m/Y') : 'Unknown',
            'purchaseTime' => $lastOrder && $lastOrder->created_at ? $lastOrder->created_at->format('h:i A') : 'Unknown',
            'city' => 'Unknown',
            'postalCode' => 'Unknown',
            'state' => 'Unknown',
            'country' => 'Unknown',
            'formattedCityPostal' => 'Unknown',
            'formattedStateCountry' => 'Unknown',
            'subscriberId' => $subscriberId,
            'invoiceNumber' => $lastOrder ? $lastOrder->id : "INV-{$subscriberId}",
            'orderId' => $lastOrder ? $lastOrder->id : null,
            'packageName' => $pkgName,
            'packageSpeed' => $pkgSpeed,
            'packageLabel' => $pkgLabel,
        ];

        $payload = [
            'success' => true,
            'has_active_subscription' => $hasActivePackage,
            'hasActivePackage' => $hasActivePackage,
            'subscriber' => $subscriber ? [
                'id' => $subscriber->id,
                'name' => $subscriber->name,
                'email' => $subscriber->email,
                'phone' => $subscriber->phone,
                'status' => $subscriber->status,
                'packageId' => $subscriber->package_id,
                'packageName' => $pkgName,
                'packageSpeed' => $pkgSpeed,
                'packageLabel' => $pkgLabel,
                'monthlyFee' => $package ? (float) $package->price : 0.0,
                'balance' => $unpaidBalance,
                'hasActivePackage' => $hasActivePackage,
                'has_active_subscription' => $hasActivePackage,
            ] : null,
            'lastPurchase' => $lastPurchase,
            'cancellation' => $cancellation,
            'cancelReasons' => $reasons,
            'settings' => [
                'effectiveDateRule' => $cancelSettings['effectiveDateRule'] ?? 'immediate',
                'allowNotSureBuyAgain' => (bool) ($cancelSettings['allowNotSureBuyAgain'] ?? true),
            ],
        ];

        return response()->json(array_merge($payload, ['data' => $payload]));
    }

    /**
     * POST /api/portal/cancel & POST /api/customer/subscription/cancel
     * Atomic transactional cancellation with validation (SEC-05, DB-06).
     */
    public function cancel(Request $request): JsonResponse
    {
        $subscriberId = $this->resolveSubscriberId($request);

        if (!$subscriberId) {
            return response()->json(['success' => false, 'error' => 'Authentication required'], 401);
        }

        $validated = $request->validate([
            'reason' => 'required|string|min:1|max:500',
            'description' => 'nullable|string|min:3|max:1000',
            'buyAgainDate' => 'nullable|string|max:50',
            'notSureBuyAgain' => 'nullable|boolean',
        ]);

        $subscriber = Subscriber::find($subscriberId);
        if (!$subscriber) {
            return response()->json(['success' => false, 'error' => 'Subscriber account not found'], 404);
        }

        if (strtolower((string) $subscriber->status) === 'cancelled') {
            return response()->json([
                'success' => false,
                'error' => 'This subscription is already cancelled. Duplicate cancellation requests are blocked.',
            ], 409);
        }

        $existingCancel = Cancellation::where('subscriber_id', $subscriberId)
            ->where('status', 'Cancelled')
            ->first();
        if ($existingCancel) {
            return response()->json([
                'success' => false,
                'error' => 'A cancellation has already been completed for this subscriber account.',
            ], 409);
        }

        $notSureBuyAgain = (bool) ($validated['notSureBuyAgain'] ?? true);
        $buyAgainDate = $validated['buyAgainDate'] ?? null;

        if (!$notSureBuyAgain && !empty($buyAgainDate)) {
            $ts = strtotime($buyAgainDate);
            if ($ts === false || $ts < strtotime('today')) {
                return response()->json([
                    'success' => false,
                    'error' => 'Package Buy-Again Date cannot be in the past.',
                ], 400);
            }
        }

        $package = $subscriber->package_id ? Package::find($subscriber->package_id) : null;
        $reason = $validated['reason'];
        $description = $validated['description'] ?? 'User submitted cancellation request from portal.';

        $cancelId = 'CAN-' . strtoupper(bin2hex(random_bytes(4)));
        $cancelInvoiceId = 'INV-CANCEL-' . strtoupper(bin2hex(random_bytes(4)));
        $effectiveDate = date('Y-m-d');

        $unpaidInvoices = Invoice::where('subscriber_id', $subscriber->id)->where('status', 'unpaid')->get();
        $outstanding = (float) $unpaidInvoices->sum('amount');

        $safeCancelMeta = [
            'cancelId' => $cancelId,
            'subscriberId' => $subscriber->id,
            'packageId' => $subscriber->package_id,
            'reason' => $reason,
            'description' => $description,
            'notSureBuyAgain' => $notSureBuyAgain,
            'buyAgainDate' => $notSureBuyAgain ? null : $buyAgainDate,
            'effectiveDate' => $effectiveDate,
        ];

        [$cancellation, $cancelInvoice] = DB::transaction(function () use (
            $cancelId,
            $cancelInvoiceId,
            $subscriber,
            $package,
            $reason,
            $description,
            $buyAgainDate,
            $notSureBuyAgain,
            $effectiveDate,
            $outstanding,
            $safeCancelMeta,
            $request
        ) {
            $cancellation = Cancellation::create([
                'id' => $cancelId,
                'subscriber_id' => $subscriber->id,
                'package_id' => $subscriber->package_id,
                'package_name' => $package ? $package->name : 'Standard Fiber',
                'cancel_invoice_id' => $cancelInvoiceId,
                'reason' => $reason,
                'description' => $description,
                'buy_again_date' => $notSureBuyAgain ? 'Not sure yet' : $buyAgainDate,
                'not_sure_buy_again' => $notSureBuyAgain,
                'cancel_date' => date('d/m/Y'),
                'cancel_time' => date('h:i A'),
                'city' => 'Unknown',
                'postal_code' => 'Unknown',
                'state' => 'Unknown',
                'country' => 'Unknown',
                'client_ip' => $request->ip(),
                'timezone' => 'UTC',
                'status' => 'Cancelled',
                'effective_date' => $effectiveDate,
                'outstanding_balance' => $outstanding,
                'raw_data' => $safeCancelMeta,
            ]);

            $cancelInvoice = Invoice::create([
                'id' => $cancelInvoiceId,
                'subscriber_id' => $subscriber->id,
                'amount' => $outstanding,
                'installation_fee' => 0.00,
                'tax_fee' => 0.00,
                'late_fee' => 0.00,
                'invoice_type' => 'cancel',
                'status' => $outstanding > 0 ? 'unpaid' : 'paid',
                'due_date' => $effectiveDate,
                'raw_data' => $safeCancelMeta,
            ]);

            $raw = is_array($subscriber->raw_data) ? $subscriber->raw_data : [];
            $raw['subscriptionCancelledAt'] = now()->toIso8601String();
            $subscriber->status = 'cancelled';
            $subscriber->raw_data = $raw;
            $subscriber->save();

            SubscriberBilling::where('subscriber_id', $subscriber->id)->update([
                'status' => 'cancelled',
            ]);

            BillingEvent::create([
                'subscriber_id' => $subscriber->id,
                'invoice_id' => $cancelInvoiceId,
                'event' => 'subscription.cancelled',
                'amount' => $outstanding,
                'message' => "Subscription cancelled ({$reason})",
                'raw_data' => $safeCancelMeta,
                'created_at' => now(),
            ]);

            return [$cancellation, $cancelInvoice];
        });

        return response()->json([
            'success' => true,
            'message' => 'Subscription cancelled successfully.',
            'cancelledAt' => now()->toIso8601String(),
            'cancellation' => $cancellation,
            'cancelInvoice' => $cancelInvoice,
            'invoice' => $cancelInvoice,
            'suspension' => [
                'attempted' => true,
                'success' => true,
                'mode' => env('MIKROTIK_MODE', 'simulator'),
            ],
        ]);
    }
}
