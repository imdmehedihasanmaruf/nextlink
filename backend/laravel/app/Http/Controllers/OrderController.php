<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\Invoice;
use App\Models\Order;
use App\Models\Package;
use App\Models\Subscriber;
use App\Services\SettingsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class OrderController
{
    protected SettingsService $settingsService;

    public function __construct(SettingsService $settingsService)
    {
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

        if ($request->has('customerId')) {
            return (string) $request->query('customerId');
        }
        if ($request->has('subscriberId')) {
            return (string) $request->query('subscriberId');
        }

        return $userSubId ?: $userId;
    }

    /**
     * GET /api/orders & GET /api/admin/orders
     * List all orders (staff).
     */
    public function index(): JsonResponse
    {
        $orders = Order::orderBy('created_at', 'desc')->get();

        return response()->json([
            'success' => true,
            'orders' => $orders,
        ]);
    }

    /**
     * GET /api/customer/orders
     * List orders for the authenticated subscriber.
     */
    public function customerOrders(Request $request): JsonResponse
    {
        $subscriberId = $this->resolveSubscriberId($request);

        if (!$subscriberId) {
            return response()->json([
                'success' => false,
                'error' => 'Authentication required',
            ], 401);
        }

        $orders = Order::where('customer_id', $subscriberId)
            ->orderBy('created_at', 'desc')
            ->get();

        return response()->json([
            'success' => true,
            'orders' => $orders,
        ]);
    }

    /**
     * POST /api/orders
     * Create order with authoritative server-side package pricing (SEC-02).
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'customerId' => 'nullable|string|max:100',
            'packageId' => 'required|string|max:100',
            'purchaseType' => 'nullable|string|max:50',
            'paymentMethod' => 'nullable|string|max:50',
            'notes' => 'nullable|string|max:500',
        ]);

        $user = $request->attributes->get('user') ?? $request->user();
        $userRole = is_object($user) ? ($user->role ?? null) : ($user['role'] ?? null);
        $userType = is_object($user) ? ($user->type ?? null) : ($user['type'] ?? null);
        $effectiveSubId = $this->resolveSubscriberId($request);

        $requestedCustomerId = $validated['customerId'] ?? $effectiveSubId;

        if (($userType === 'subscriber' || $userRole === 'subscriber') && $requestedCustomerId !== $effectiveSubId) {
            return response()->json([
                'success' => false,
                'error' => 'You can only create orders for your own subscriber account',
            ], 403);
        }

        if (empty($requestedCustomerId)) {
            return response()->json(['success' => false, 'error' => 'customerId is required'], 400);
        }

        $subscriber = Subscriber::find($requestedCustomerId);
        if (!$subscriber) {
            return response()->json(['success' => false, 'error' => 'Customer not found'], 404);
        }

        $package = Package::find($validated['packageId']);
        if (!$package) {
            return response()->json(['success' => false, 'error' => 'Package not found'], 404);
        }

        // Server-side authoritative pricing calculation — client price overrides are strictly ignored
        $billingSettings = $this->settingsService->getGroup('billing');
        $monthlyPrice = (float) $package->price;
        $purchaseType = $validated['purchaseType'] ?? 'New Connection';
        $isFirstPurchase = Order::where('customer_id', $subscriber->id)->where('order_status', 'Active')->doesntExist();

        $installationFee = $isFirstPurchase ? (float) ($billingSettings['installationFee'] ?? 8.99) : 0.00;
        $taxFee = $isFirstPurchase ? (float) ($billingSettings['taxFee'] ?? 0.99) : 0.00;
        $totalPayable = round($monthlyPrice + $installationFee + $taxFee, 2);

        $year = date('Y');
        $random = strtoupper(substr(bin2hex(random_bytes(4)), 0, 8));
        $id = "ORD-{$year}-{$random}";

        $safeRawData = [
            'customerId' => $subscriber->id,
            'packageId' => $package->id,
            'packageName' => $package->name,
            'purchaseType' => $purchaseType,
            'monthlyPrice' => $monthlyPrice,
            'installationFee' => $installationFee,
            'taxes' => $taxFee,
            'totalPayable' => $totalPayable,
            'paymentMethod' => $validated['paymentMethod'] ?? 'bKash',
            'notes' => $validated['notes'] ?? null,
        ];

        $order = DB::transaction(function () use ($id, $subscriber, $package, $purchaseType, $monthlyPrice, $installationFee, $taxFee, $totalPayable, $validated, $safeRawData) {
            return Order::create([
                'id' => $id,
                'customer_id' => $subscriber->id,
                'customer_name' => $subscriber->name,
                'package_id' => $package->id,
                'package_name' => $package->name,
                'purchase_type' => $purchaseType,
                'download_speed' => (int) $package->speed,
                'upload_speed' => (int) $package->upload_speed,
                'monthly_price' => $monthlyPrice,
                'installation_fee' => $installationFee,
                'taxes' => $taxFee,
                'total_payable' => $totalPayable,
                'payment_method' => $validated['paymentMethod'] ?? 'bKash',
                'payment_status' => 'Payment Pending',
                'order_status' => 'Pending Activation',
                'raw_data' => $safeRawData,
            ]);
        });

        return response()->json([
            'success' => true,
            'order' => $order,
        ], 201);
    }

    /**
     * PUT /api/admin/orders & PATCH /api/admin/orders/{id} & PATCH /api/orders/{id}/status
     * Update order status (super_admin, billing only).
     */
    public function updateStatus(Request $request, ?string $id = null): JsonResponse
    {
        $orderId = $id ?? $request->input('orderId');
        if (empty($orderId)) {
            return response()->json(['success' => false, 'error' => 'Order ID is required'], 400);
        }

        $order = Order::find($orderId);
        if (!$order) {
            return response()->json(['success' => false, 'error' => 'Order not found'], 404);
        }

        $status = $request->input('status') ?? $request->input('order_status');
        $allowedStatuses = ['Active', 'Cancelled', 'Pending Activation', 'Suspended', 'Completed'];
        if (!empty($status) && !in_array($status, $allowedStatuses, true)) {
            return response()->json([
                'success' => false,
                'error' => 'Invalid order status. Allowed: ' . implode(', ', $allowedStatuses),
            ], 400);
        }

        $paymentStatus = $request->input('paymentStatus') ?? $request->input('payment_status');

        $user = $request->attributes->get('user') ?? $request->user();
        $actorId = is_object($user) ? ($user->id ?? 'staff') : ($user['id'] ?? 'staff');
        $actorRole = is_object($user) ? ($user->role ?? 'staff') : ($user['role'] ?? 'staff');

        DB::transaction(function () use ($order, $status, $paymentStatus, $actorId, $actorRole, $request) {
            if (!empty($status)) {
                $order->order_status = $status;
            }
            if (!empty($paymentStatus)) {
                $order->payment_status = $paymentStatus;
            }
            $order->save();

            AuditLog::create([
                'actor_id' => $actorId,
                'actor_role' => $actorRole,
                'action' => 'order.status_updated',
                'entity_type' => 'order',
                'entity_id' => $order->id,
                'details' => [
                    'orderStatus' => $order->order_status,
                    'paymentStatus' => $order->payment_status,
                ],
                'ip_address' => $request->ip(),
                'created_at' => now(),
            ]);
        });

        return response()->json([
            'success' => true,
            'message' => 'Order updated successfully',
            'order' => $order,
            'provisioning' => [
                'attempted' => $status === 'Active',
                'success' => true,
                'mode' => env('MIKROTIK_MODE', 'simulator'),
            ],
        ]);
    }

    /**
     * POST /api/customer/orders/create-and-pay
     * Atomic order + purchase invoice creation with server-side quote calculation.
     */
    public function createAndPay(Request $request): JsonResponse
    {
        $subscriberId = $this->resolveSubscriberId($request);

        if (!$subscriberId) {
            return response()->json(['success' => false, 'error' => 'Authentication required'], 401);
        }

        $validated = $request->validate([
            'packageId' => 'required|string|max:100',
            'purchaseType' => 'nullable|string|max:50',
            'paymentMethod' => 'nullable|string|max:50',
            'acceptedTerms' => 'nullable|boolean',
            'sessionGeolocation' => 'nullable|array',
        ]);

        if ($request->has('acceptedTerms') && !$request->boolean('acceptedTerms')) {
            return response()->json([
                'success' => false,
                'error' => 'You must accept the terms and conditions before placing an order',
            ], 400);
        }

        $package = Package::find($validated['packageId']);
        if (!$package) {
            return response()->json(['success' => false, 'error' => 'Selected package not found in catalog'], 404);
        }

        $subscriber = Subscriber::find($subscriberId);
        if (!$subscriber) {
            return response()->json(['success' => false, 'error' => 'Subscriber not found'], 404);
        }

        $billingSettings = $this->settingsService->getGroup('billing');
        $monthlyPrice = (float) $package->price;
        $installationFee = (float) ($billingSettings['installationFee'] ?? 8.99);
        $taxFee = (float) ($billingSettings['taxFee'] ?? 0.99);
        $totalPayable = round($monthlyPrice + $installationFee + $taxFee, 2);

        $year = date('Y');
        $random = strtoupper(substr(bin2hex(random_bytes(4)), 0, 8));
        $orderId = "ORD-{$year}-{$random}";
        $invoiceId = "INV-PURCHASE-{$year}-{$random}";

        $purchaseType = $validated['purchaseType'] ?? 'New Connection';
        $paymentMethod = $validated['paymentMethod'] ?? 'bkash';

        $safeRawData = [
            'customerId' => $subscriber->id,
            'packageId' => $package->id,
            'packageName' => $package->name,
            'purchaseType' => $purchaseType,
            'paymentMethod' => $paymentMethod,
            'invoiceId' => $invoiceId,
            'purchaseSession' => [
                'purchaseDate' => date('d/m/Y'),
                'purchaseTime' => date('h:i A'),
                'city' => $validated['sessionGeolocation']['city'] ?? 'Unknown',
                'postalCode' => $validated['sessionGeolocation']['postalCode'] ?? 'Unknown',
                'state' => $validated['sessionGeolocation']['state'] ?? 'Unknown',
                'country' => $validated['sessionGeolocation']['country'] ?? 'Unknown',
                'clientIp' => $request->ip(),
            ],
        ];

        [$order, $invoice] = DB::transaction(function () use (
            $orderId,
            $invoiceId,
            $subscriber,
            $package,
            $purchaseType,
            $monthlyPrice,
            $installationFee,
            $taxFee,
            $totalPayable,
            $paymentMethod,
            $safeRawData
        ) {
            $order = Order::create([
                'id' => $orderId,
                'customer_id' => $subscriber->id,
                'customer_name' => $subscriber->name,
                'package_id' => $package->id,
                'package_name' => $package->name,
                'purchase_type' => $purchaseType,
                'download_speed' => (int) $package->speed,
                'upload_speed' => (int) $package->upload_speed,
                'monthly_price' => $monthlyPrice,
                'installation_fee' => $installationFee,
                'taxes' => $taxFee,
                'total_payable' => $totalPayable,
                'payment_method' => $paymentMethod,
                'payment_status' => 'Payment Pending',
                'order_status' => 'Pending Activation',
                'raw_data' => $safeRawData,
            ]);

            $invoice = Invoice::create([
                'id' => $invoiceId,
                'subscriber_id' => $subscriber->id,
                'amount' => $totalPayable,
                'installation_fee' => $installationFee,
                'tax_fee' => $taxFee,
                'late_fee' => 0.00,
                'invoice_type' => 'purchase',
                'status' => 'unpaid',
                'due_date' => date('Y-m-d'),
                'raw_data' => [
                    'orderId' => $orderId,
                    'packageId' => $package->id,
                    'packageName' => $package->name,
                    'packageSpeed' => (int) $package->speed,
                    'packagePrice' => $monthlyPrice,
                    'source' => 'package-order',
                    'purchaseSession' => $safeRawData['purchaseSession'],
                ],
            ]);

            return [$order, $invoice];
        });

        return response()->json([
            'success' => true,
            'message' => 'Order created and ready for payment',
            'order' => $order,
            'payment' => [
                'invoiceId' => $invoice->id,
                'amount' => $totalPayable,
                'currency' => $billingSettings['currency'] ?? 'USD',
                'gateway' => $paymentMethod,
            ],
        ], 201);
    }
}
