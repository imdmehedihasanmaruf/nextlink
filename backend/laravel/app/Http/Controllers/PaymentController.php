<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\Invoice;
use App\Models\PaymentTransaction;
use App\Models\PaymentWebhook;
use App\Models\Subscriber;
use App\Services\PaymentGatewayService;
use App\Services\PaymentSettlementService;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;

class PaymentController extends Controller
{
    protected PaymentGatewayService $gatewayService;
    protected PaymentSettlementService $settlementService;

    public function __construct(
        PaymentGatewayService $gatewayService,
        PaymentSettlementService $settlementService
    ) {
        $this->gatewayService = $gatewayService;
        $this->settlementService = $settlementService;
    }

    /**
     * Determine if current request is treated as production
     */
    protected function isProduction(?Request $request = null): bool
    {
        if (config('app.env') === 'production') {
            return true;
        }
        if ($request && strtolower((string) $request->header('X-Simulate-Production', '')) === 'true') {
            return true;
        }
        return false;
    }

    /**
     * Strict server-side database mutation guard:
     * In non-production environments, verifies active database is strictly 'nextlink_test_db'
     * on the active connection before ANY mutation (insert, update, delete) can execute.
     */
    protected function ensureMutationSafety(?Request $request = null): void
    {
        if ($this->isProduction($request)) {
            return;
        }
        $dbName = DB::connection()->getDatabaseName();
        if ($dbName !== 'nextlink_test_db') {
            throw new \RuntimeException(
                "CRITICAL ISOLATION HALT: Attempted payment mutation on '{$dbName}' instead of 'nextlink_test_db'!"
            );
        }
    }

    /**
     * Resolve authenticated subscriber identity
     */
    protected function resolveSubscriberId(Request $request): ?string
    {
        $user = $request->attributes->get('user') ?? $request->attributes->get('auth_user');
        if ($user) {
            if (is_object($user)) {
                return $user->subscriberId ?? $user->subscriber_id ?? $user->id ?? null;
            }
            if (is_array($user)) {
                return $user['subscriberId'] ?? $user['subscriber_id'] ?? $user['id'] ?? null;
            }
        }

        $authHeader = $request->header('Authorization', '');
        if (str_starts_with($authHeader, 'Bearer ')) {
            $token = substr($authHeader, 7);
            try {
                $jwtService = app(\App\Services\JwtService::class);
                $payload = $jwtService->verify($token);
                return $payload['subscriberId'] ?? $payload['subscriber_id'] ?? $payload['id'] ?? null;
            } catch (\Throwable $e) {}
        }

        return null;
    }

    /**
     * Resolve user role from request
     */
    protected function resolveUserRole(Request $request): string
    {
        $user = $request->attributes->get('user') ?? $request->attributes->get('auth_user');
        if ($user) {
            if (is_object($user)) {
                return (string) ($user->role ?? '');
            }
            if (is_array($user)) {
                return (string) ($user['role'] ?? '');
            }
        }

        $authHeader = $request->header('Authorization', '');
        if (str_starts_with($authHeader, 'Bearer ')) {
            $token = substr($authHeader, 7);
            try {
                $jwtService = app(\App\Services\JwtService::class);
                $payload = $jwtService->verify($token);
                return (string) ($payload['role'] ?? '');
            } catch (\Throwable $e) {}
        }

        return '';
    }

    /**
     * GET /api/payments/gateways
     * List available gateways and active mode
     */
    public function gateways(): JsonResponse
    {
        return response()->json([
            'success' => true,
            'mode' => $this->gatewayService->getMode(),
            'gateways' => $this->gatewayService->listGateways(),
        ]);
    }

    /**
     * POST /api/payments/initiate
     * Start a payment session for an invoice
     */
    public function initiate(Request $request): JsonResponse
    {
        $this->ensureMutationSafety($request);

        $rawGateway = strtolower(trim((string) $request->input('gateway', '')));
        if ($rawGateway === 'mock' && ($this->isProduction($request) || $this->gatewayService->getMode() === 'live')) {
            return response()->json([
                'success' => false,
                'error' => 'The mock payment gateway is disabled in production',
            ], 404);
        }

        if (!in_array($rawGateway, ['bkash', 'nagad', 'sslcommerz', 'rocket', 'mock'])) {
            return response()->json([
                'success' => false,
                'error' => "Unknown payment gateway: {$rawGateway}",
            ], 400);
        }

        $validated = $request->validate([
            'invoiceId' => 'required|string|max:100',
            'gateway' => 'required|string|in:bkash,nagad,sslcommerz,rocket,mock',
            'subscriberId' => 'nullable|string|max:100',
            'customer' => 'nullable|array',
        ]);

        $invoice = Invoice::find($validated['invoiceId']);
        if (!$invoice) {
            return response()->json(['success' => false, 'error' => 'Invoice not found'], 404);
        }

        if (strtolower((string) $invoice->status) === 'paid') {
            return response()->json(['success' => false, 'error' => 'Invoice is already paid'], 409);
        }

        // Subscriber tenant isolation check: subscriber may only pay their own invoices
        $callerRole = $this->resolveUserRole($request);
        $callerSubId = $this->resolveSubscriberId($request);
        if ($callerRole === 'subscriber' && $callerSubId) {
            if ($invoice->subscriber_id && $invoice->subscriber_id !== $callerSubId) {
                return response()->json(['success' => false, 'error' => 'You can only pay your own invoices'], 403);
            }
        }

        $subscriberId = $validated['subscriberId'] ?? $invoice->subscriber_id;
        $subscriber = $subscriberId ? Subscriber::find($subscriberId) : null;
        $subRaw = is_array($subscriber?->raw_data) ? $subscriber->raw_data : [];
        $invRaw = is_array($invoice->raw_data) ? $invoice->raw_data : [];

        $customer = $validated['customer'] ?? [
            'name' => $subscriber?->name ?? ($invRaw['subscriberName'] ?? ''),
            'email' => $subscriber?->email ?? ($invRaw['subscriberEmail'] ?? ''),
            'phone' => $subscriber?->phone ?? ($invRaw['subscriberPhone'] ?? ''),
            'address' => $subRaw['address'] ?? '',
        ];

        try {
            $result = $this->gatewayService->createPayment($validated['gateway'], [
                'invoiceId' => $invoice->id,
                'subscriberId' => $subscriberId,
                'amount' => (float) $invoice->amount,
                'customer' => $customer,
            ]);

            $txnId = 'PAY-' . strtoupper(bin2hex(random_bytes(6)));

            $transaction = PaymentTransaction::create([
                'id' => $txnId,
                'invoice_id' => $invoice->id,
                'subscriber_id' => $subscriberId,
                'gateway' => strtolower($validated['gateway']),
                'amount' => (float) $invoice->amount,
                'currency' => 'USD',
                'status' => 'pending',
                'gateway_txn_id' => $result['transactionId'],
                'reference' => $result['transactionId'],
                'method' => strtolower($validated['gateway']),
                'raw_data' => $result['raw'],
                'created_at' => Carbon::now('UTC'),
                'updated_at' => Carbon::now('UTC'),
            ]);

            AuditLog::create([
                'actor_id' => $callerSubId ?: ($subscriberId ?: 'anonymous'),
                'actor_role' => $callerRole ?: 'subscriber',
                'action' => 'payment.initiated',
                'entity_type' => 'invoice',
                'entity_id' => $invoice->id,
                'details' => [
                    'gateway' => $validated['gateway'],
                    'transactionId' => $result['transactionId'],
                ],
                'ip_address' => $request->ip() ?? '127.0.0.1',
            ]);

            return response()->json([
                'success' => true,
                'transactionId' => $transaction->id,
                'gatewayTransactionId' => $result['transactionId'],
                'redirectUrl' => $result['redirectUrl'],
                'amount' => (float) $invoice->amount,
                'currency' => 'USD',
                'invoiceId' => $invoice->id,
            ]);
        } catch (\Throwable $e) {
            return response()->json([
                'success' => false,
                'error' => "Payment gateway error: {$e->getMessage()}",
            ], 502);
        }
    }

    /**
     * ALL /api/payments/:gateway/callback
     * Gateway settlement callbacks (POST server-to-server or GET browser redirect)
     */
    public function callback(Request $request, string $gateway)
    {
        $gatewayName = strtolower($gateway);
        if (!in_array($gatewayName, ['bkash', 'nagad', 'sslcommerz', 'rocket', 'mock'])) {
            return response()->json(['success' => false, 'error' => "Unknown gateway: {$gatewayName}"], 404);
        }

        if ($gatewayName === 'mock' && ($this->gatewayService->getMode() === 'live' || $this->isProduction($request))) {
            return response()->json([
                'success' => false,
                'error' => 'The mock payment gateway is disabled while the deployment runs in live mode.',
            ], 404);
        }

        $this->ensureMutationSafety($request);

        $body = array_merge($request->query(), $request->json()->all() ?: $request->all());
        $parsed = $this->gatewayService->parseWebhook($gatewayName, $body);

        $webhook = PaymentWebhook::create([
            'gateway' => $gatewayName,
            'event_type' => $body['status'] ?? ($body['event_type'] ?? 'callback'),
            'gateway_txn_id' => $parsed['transactionId'] ?? null,
            'payload' => $body,
            'status' => 'received',
            'created_at' => Carbon::now('UTC'),
        ]);

        $transaction = null;
        if (!empty($parsed['transactionId'])) {
            $transaction = PaymentTransaction::where('gateway_txn_id', $parsed['transactionId'])
                ->orderBy('created_at', 'desc')
                ->first();
        }

        if (!$transaction) {
            $webhook->update(['status' => 'unmatched', 'processed_at' => Carbon::now('UTC')]);
            return response()->json(['success' => false, 'error' => 'No matching payment transaction found'], 404);
        }

        $isMock = ($this->gatewayService->getMode() === 'mock');
        if ($transaction->gateway !== $gatewayName && !($gatewayName === 'mock' && $isMock)) {
            $webhook->update(['status' => 'gateway_mismatch', 'processed_at' => Carbon::now('UTC')]);
            return response()->json([
                'success' => false,
                'error' => "This transaction belongs to {$transaction->gateway}, not {$gatewayName}",
            ], 400);
        }

        $verification = $this->gatewayService->verifyWebhook($gatewayName, $body);
        if (!($verification['verified'] ?? false)) {
            $webhook->update([
                'status' => 'unverified',
                'error' => $verification['reason'] ?? 'verification failed',
                'processed_at' => Carbon::now('UTC'),
            ]);
            return response()->json([
                'success' => false,
                'error' => "The callback could not be verified: " . ($verification['reason'] ?? 'failed'),
            ], 401);
        }

        if ($parsed['status'] !== 'success') {
            $transaction->update([
                'status' => $parsed['status'] ?: 'failed',
                'updated_at' => Carbon::now('UTC'),
            ]);
            $webhook->update(['status' => 'not_settled', 'processed_at' => Carbon::now('UTC')]);

            return response()->json([
                'success' => false,
                'status' => $parsed['status'],
                'message' => 'Payment was not completed',
            ], 200);
        }

        // Amount matching check
        $settledAmount = isset($parsed['amount']) && $parsed['amount'] !== null
            ? (float) $parsed['amount']
            : (float) $transaction->amount;
        $expectedAmount = (float) $transaction->amount;

        if ($expectedAmount > 0 && abs($settledAmount - $expectedAmount) > 0.01) {
            $errMsg = "settled {$settledAmount} but the invoice is for {$expectedAmount}";
            $webhook->update([
                'status' => 'amount_mismatch',
                'error' => $errMsg,
                'processed_at' => Carbon::now('UTC'),
            ]);
            return response()->json([
                'success' => false,
                'error' => "The settled amount ({$settledAmount}) does not match the invoice ({$expectedAmount})",
            ], 400);
        }

        // Apply atomic settlement
        $result = $this->settlementService->applyPayment([
            'invoiceId' => $transaction->invoice_id,
            'transactionId' => $parsed['transactionId'],
            'gateway' => $transaction->gateway,
            'amount' => $settledAmount,
            'raw' => $parsed['raw'] ?? [],
        ]);

        $transaction->update([
            'status' => 'success',
            'updated_at' => Carbon::now('UTC'),
        ]);
        $webhook->update([
            'status' => 'processed',
            'processed_at' => Carbon::now('UTC'),
        ]);

        // If browser GET redirect with Accept: text/html
        $acceptsHtml = str_contains((string) $request->header('Accept'), 'text/html');
        if ($request->isMethod('get') && $acceptsHtml && $transaction->invoice_id) {
            $portal = rtrim(config('payments.portal_public_url', 'http://localhost:3000'), '/');
            return redirect("{$portal}/dashboard?paid=" . urlencode($transaction->invoice_id));
        }

        return response()->json([
            'success' => true,
            'status' => 'success',
            'invoiceId' => $transaction->invoice_id,
            'alreadyPaid' => $result['alreadyPaid'] ?? false,
            'activated' => false,
        ]);
    }

    /**
     * GET /api/payments/mock/checkout/:transactionId
     * Mock hosted checkout page simulating customer payment
     */
    public function mockCheckout(Request $request, string $transactionId)
    {
        if ($this->gatewayService->getMode() !== 'mock' || $this->isProduction($request)) {
            return response()->json(['success' => false, 'error' => 'Mock checkout is disabled in production'], 404);
        }

        $this->ensureMutationSafety($request);

        $transaction = PaymentTransaction::where('gateway_txn_id', $transactionId)->first();
        if (!$transaction) {
            return response()->json(['success' => false, 'error' => 'Transaction not found'], 404);
        }

        $amount = (float) $transaction->amount;
        $cancelled = ($request->query('cancel') === '1');

        // Execute mock settlement callback internally
        $mockReq = Request::create(
            "/api/payments/mock/callback",
            'POST',
            [
                'transactionId' => $transactionId,
                'status' => $cancelled ? 'cancelled' : 'success',
                'amount' => $amount,
                'invoiceId' => $transaction->invoice_id,
            ]
        );
        $mockReq->headers->set('Accept', 'application/json');

        $res = $this->callback($mockReq, 'mock');
        $resData = json_decode($res->getContent(), true) ?: [];
        $settled = ($resData['success'] ?? false) && ($resData['status'] ?? '') === 'success';

        $portal = rtrim(config('payments.portal_public_url', 'http://localhost:3000'), '/');
        $invoiceId = $transaction->invoice_id;
        $formattedAmount = number_format($amount, 2);
        $statusClass = $settled ? 'ok' : 'bad';
        $statusMsg = $settled ? 'Payment completed successfully.' : 'Payment was not completed.';

        $html = <<<HTML
<!doctype html><html><head><meta charset="utf-8"><title>NextLink Mock Checkout</title>
<style>body{font-family:system-ui;background:#0b1220;color:#e6edf7;display:grid;place-items:center;height:100vh;margin:0}
.card{background:#111a2e;border:1px solid #1f2b45;border-radius:14px;padding:32px;max-width:420px;text-align:center}
h1{margin:0 0 6px;font-size:20px}.amt{font-size:30px;font-weight:700;margin:12px 0}
.muted{color:#8fa3c0;font-size:13px;margin-bottom:18px}
.ok{color:#38d39f}.bad{color:#ff7b72}
a{display:inline-block;margin:6px;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600}
.pay{background:#2563eb;color:#fff}.cancel{background:#1f2b45;color:#cbd5e1}
.done{background:#16a34a;color:#052e16}</style></head>
<body><div class="card">
<h1>Mock {$transaction->gateway} Checkout</h1>
<div class="amt">USD {$formattedAmount}</div>
<div class="muted">Invoice {$transaction->invoice_id} · Txn {$transaction->gateway_txn_id}</div>
<p class="{$statusClass}">{$statusMsg}</p>
HTML;

        if ($settled) {
            $html .= "<a class=\"done\" href=\"{$portal}/dashboard?paid=" . urlencode($invoiceId) . "\">Return to your dashboard</a>";
        } else {
            $html .= "<a class=\"pay\" href=\"/api/payments/mock/checkout/" . urlencode($transaction->gateway_txn_id) . "\">Pay now</a>";
            $html .= "<a class=\"cancel\" href=\"/api/payments/mock/checkout/" . urlencode($transaction->gateway_txn_id) . "?cancel=1\">Cancel</a>";
        }

        $html .= "</div></body></html>";

        return response($html, 200)->header('Content-Type', 'text/html');
    }

    /**
     * GET /api/payments/transactions
     * Payment transactions ledger (admin)
     */
    public function transactions(Request $request): JsonResponse
    {
        $limit = min(max((int) ($request->query('limit') ?: 100), 1), 500);
        $status = $request->query('status');

        $query = PaymentTransaction::orderBy('created_at', 'desc')->take($limit);
        if ($status && $status !== 'all') {
            $query->where('status', $status);
        }

        return response()->json([
            'success' => true,
            'transactions' => $query->get(),
        ]);
    }

    /**
     * POST /api/payments/verify
     * Reconcile / manually verify a transaction with gateway
     */
    public function verify(Request $request): JsonResponse
    {
        $this->ensureMutationSafety($request);

        $validated = $request->validate([
            'gateway' => 'required|string|in:bkash,nagad,sslcommerz,rocket,mock',
            'transactionId' => 'required|string|min:1',
            'payload' => 'nullable|array',
        ]);

        $result = $this->gatewayService->verifyPayment($validated['gateway'], [
            'transactionId' => $validated['transactionId'],
            'payload' => $validated['payload'] ?? [],
        ]);

        if (($result['status'] ?? '') === 'success') {
            $transaction = PaymentTransaction::where('gateway', $validated['gateway'])
                ->where('gateway_txn_id', $validated['transactionId'])
                ->first();

            if ($transaction) {
                $this->settlementService->applyPayment([
                    'invoiceId' => $transaction->invoice_id,
                    'transactionId' => $validated['transactionId'],
                    'gateway' => $validated['gateway'],
                    'amount' => $result['amount'] ?? (float) $transaction->amount,
                    'raw' => $result['raw'] ?? [],
                ]);

                $transaction->update([
                    'status' => 'success',
                    'updated_at' => Carbon::now('UTC'),
                ]);
            }
        }

        return response()->json(array_merge(['success' => true], $result));
    }

    /**
     * GET /api/payments/webhooks
     * Webhook log (admin)
     */
    public function webhooks(Request $request): JsonResponse
    {
        $limit = min(max((int) ($request->query('limit') ?: 100), 1), 500);
        $webhooks = PaymentWebhook::orderBy('created_at', 'desc')->take($limit)->get();

        return response()->json([
            'success' => true,
            'webhooks' => $webhooks,
        ]);
    }

    /**
     * GET /api/payments/reconciliation
     * Comprehensive read-only payment reconciliation report (admin)
     */
    public function reconciliation(Request $request): JsonResponse
    {
        $limit = min(max((int) ($request->query('limit') ?: 100), 1), 500);
        $transactions = PaymentTransaction::orderBy('created_at', 'desc')->take($limit)->get();
        $discrepancies = [];

        foreach ($transactions as $tx) {
            if (!$tx->invoice_id) {
                $discrepancies[] = [
                    'id' => "DISC-ORPHAN-{$tx->id}",
                    'type' => 'ORPHAN_TRANSACTION',
                    'severity' => 'critical',
                    'transactionId' => $tx->id,
                    'invoiceId' => null,
                    'gateway' => $tx->gateway,
                    'gatewayTxnId' => $tx->gateway_txn_id,
                    'subscriberId' => $tx->subscriber_id,
                    'localStatus' => $tx->status,
                    'providerStatus' => null,
                    'description' => "Transaction {$tx->id} has no invoice_id assigned.",
                    'details' => ['amount' => $tx->amount, 'gateway' => $tx->gateway],
                    'detectedAt' => Carbon::now('UTC')->toIso8601String(),
                    'recommendedAction' => 'Link transaction to appropriate subscriber invoice.',
                ];
                continue;
            }

            $invoice = Invoice::find($tx->invoice_id);
            if (!$invoice) {
                $discrepancies[] = [
                    'id' => "DISC-ORPHAN-{$tx->id}",
                    'type' => 'ORPHAN_TRANSACTION',
                    'severity' => 'critical',
                    'transactionId' => $tx->id,
                    'invoiceId' => $tx->invoice_id,
                    'gateway' => $tx->gateway,
                    'gatewayTxnId' => $tx->gateway_txn_id,
                    'subscriberId' => $tx->subscriber_id,
                    'localStatus' => $tx->status,
                    'providerStatus' => null,
                    'description' => "Transaction {$tx->id} references non-existent invoice '{$tx->invoice_id}'.",
                    'details' => ['amount' => $tx->amount, 'gateway' => $tx->gateway],
                    'detectedAt' => Carbon::now('UTC')->toIso8601String(),
                    'recommendedAction' => 'Link transaction to appropriate subscriber invoice.',
                ];
                continue;
            }

            $txAmount = (float) $tx->amount;
            $invAmount = (float) $invoice->amount;
            if (abs($txAmount - $invAmount) > 0.01) {
                $discrepancies[] = [
                    'id' => "DISC-AMT-{$tx->id}",
                    'type' => 'AMOUNT_MISMATCH',
                    'severity' => 'critical',
                    'transactionId' => $tx->id,
                    'invoiceId' => $tx->invoice_id,
                    'gateway' => $tx->gateway,
                    'gatewayTxnId' => $tx->gateway_txn_id,
                    'subscriberId' => $tx->subscriber_id,
                    'localStatus' => $tx->status,
                    'providerStatus' => null,
                    'description' => "Transaction amount differs from invoice {$invoice->id} amount.",
                    'details' => ['transactionAmount' => $txAmount, 'invoiceAmount' => $invAmount],
                    'detectedAt' => Carbon::now('UTC')->toIso8601String(),
                    'recommendedAction' => 'Review price calculations before settling.',
                ];
            }
        }

        $filtered = $request->query('discrepancyType') && $request->query('discrepancyType') !== 'all'
            ? array_values(array_filter($discrepancies, fn($d) => $d['type'] === $request->query('discrepancyType')))
            : $discrepancies;

        return response()->json([
            'success' => true,
            'timestamp' => Carbon::now('UTC')->toIso8601String(),
            'summary' => [
                'total_transactions_scanned' => $transactions->count(),
                'total_invoices_scanned' => Invoice::count(),
                'discrepancies_count' => count($filtered),
                'status' => count($filtered) === 0 ? 'clean' : 'discrepancies_detected',
            ],
            'discrepancies' => $filtered,
        ]);
    }

    /**
     * POST /api/payments/reconciliation/resolve
     */
    public function resolveReconciliation(Request $request): JsonResponse
    {
        $this->ensureMutationSafety($request);

        $validated = $request->validate([
            'discrepancyType' => 'required|string',
            'transactionId' => 'nullable|string',
            'invoiceId' => 'nullable|string',
            'action' => 'required|string|in:mark_invoice_paid,sync_transaction_status,record_missing_event,dismiss',
            'reason' => 'required|string|min:5',
        ]);

        AuditLog::create([
            'actor_id' => $request->attributes->get('auth_user')['id'] ?? 'staff',
            'actor_role' => $request->attributes->get('auth_user')['role'] ?? 'billing',
            'action' => 'payment.reconciliation_resolved',
            'entity_type' => 'reconciliation',
            'entity_id' => $validated['transactionId'] ?? ($validated['invoiceId'] ?? 'discrepancy'),
            'details' => $validated,
            'ip_address' => $request->ip() ?? '127.0.0.1',
        ]);

        return response()->json([
            'success' => true,
            'resolved' => true,
            'action' => $validated['action'],
            'transactionId' => $validated['transactionId'] ?? null,
            'invoiceId' => $validated['invoiceId'] ?? null,
        ]);
    }

    /**
     * GET /api/payments/operations/stats
     */
    public function operationsStats(Request $request): JsonResponse
    {
        $txStats = DB::selectOne("
            SELECT
                COUNT(*)::int AS total_count,
                COALESCE(SUM(amount), 0) AS total_amount,
                COUNT(*) FILTER (WHERE status = 'success' OR status = 'settled')::int AS settled_count,
                COALESCE(SUM(amount) FILTER (WHERE status = 'success' OR status = 'settled'), 0) AS settled_amount,
                COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count,
                COALESCE(SUM(amount) FILTER (WHERE status = 'pending'), 0) AS pending_amount,
                COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count,
                COALESCE(SUM(amount) FILTER (WHERE status = 'failed'), 0) AS failed_amount,
                COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_count,
                COALESCE(SUM(amount) FILTER (WHERE status = 'cancelled'), 0) AS cancelled_amount
            FROM payment_transactions
        ");

        $whStats = DB::selectOne("
            SELECT
                COUNT(*)::int AS total_webhooks,
                COUNT(*) FILTER (WHERE status = 'processed')::int AS processed_count,
                COUNT(*) FILTER (WHERE status = 'received' OR status = 'pending')::int AS pending_count,
                COUNT(*) FILTER (WHERE status = 'failed' OR status = 'unverified' OR status = 'amount_mismatch' OR status = 'gateway_mismatch')::int AS failed_count,
                COUNT(*) FILTER (WHERE status = 'dead_letter')::int AS dead_letter_count
            FROM payment_webhooks
        ");

        return response()->json([
            'success' => true,
            'mode' => $this->gatewayService->getMode(),
            'transactions' => $txStats,
            'webhooks' => $whStats,
            'gateways' => $this->gatewayService->listGateways(),
            'timestamp' => Carbon::now('UTC')->toIso8601String(),
        ]);
    }

    /**
     * GET /api/payments/alerts
     */
    public function alerts(Request $request): JsonResponse
    {
        return response()->json([
            'success' => true,
            'alerts' => [],
            'total_alerts' => 0,
            'critical_count' => 0,
            'high_count' => 0,
            'timestamp' => Carbon::now('UTC')->toIso8601String(),
        ]);
    }

    /**
     * POST /api/payments/webhooks/{id}/retry
     */
    public function retryWebhook(Request $request, string $id): JsonResponse
    {
        $this->ensureMutationSafety($request);

        $webhook = PaymentWebhook::find($id);
        if (!$webhook) {
            return response()->json(['success' => false, 'error' => 'Webhook event not found'], 404);
        }

        if ($webhook->status === 'processed') {
            return response()->json([
                'success' => true,
                'alreadySettled' => true,
                'message' => 'Webhook already successfully processed',
            ], 200);
        }

        $attempts = ($webhook->retry_count ?? 0) + 1;
        $webhook->update([
            'retry_count' => $attempts,
            'status' => $attempts >= 5 ? 'dead_letter' : 'pending',
            'processed_at' => Carbon::now('UTC'),
        ]);

        return response()->json([
            'success' => true,
            'webhookId' => $id,
            'status' => $webhook->status,
            'retryCount' => $attempts,
        ]);
    }

    /**
     * POST /api/payments/mock/refund
     */
    public function mockRefund(Request $request): JsonResponse
    {
        if ($this->isProduction($request)) {
            return response()->json(['success' => false, 'error' => 'Mock refund is disabled in production.'], 404);
        }
        $this->ensureMutationSafety($request);

        $validated = $request->validate([
            'transactionId' => 'nullable|string',
            'invoiceId' => 'nullable|string',
            'amount' => 'nullable|numeric',
            'reason' => 'nullable|string',
        ]);

        $txnId = $validated['transactionId'] ?? null;
        $invId = $validated['invoiceId'] ?? null;

        if (!$txnId && !$invId) {
            return response()->json(['success' => false, 'error' => 'transactionId or invoiceId is required'], 400);
        }

        $query = PaymentTransaction::query();
        if ($txnId) {
            $query->where('gateway_txn_id', $txnId)->orWhere('id', $txnId);
        } else {
            $query->where('invoice_id', $invId);
        }
        $txn = $query->orderBy('created_at', 'desc')->first();

        if (!$txn) {
            return response()->json(['success' => false, 'error' => 'Transaction not found'], 404);
        }

        $refundAmount = isset($validated['amount']) ? (float)$validated['amount'] : (float)$txn->amount;
        $refundId = 'REF-' . strtoupper(bin2hex(random_bytes(4)));

        $raw = $txn->raw_data ?? [];
        if (!is_array($raw)) {
            $raw = json_decode((string)$raw, true) ?: [];
        }
        $raw['refundId'] = $refundId;
        $raw['refundAmount'] = $refundAmount;
        $raw['reason'] = $validated['reason'] ?? 'Mock refund request';
        $raw['refundedAt'] = Carbon::now('UTC')->toIso8601String();

        $txn->update([
            'status' => 'refunded',
            'raw_data' => $raw,
        ]);

        return response()->json([
            'success' => true,
            'refundId' => $refundId,
            'transactionId' => $txn->gateway_txn_id,
            'amount' => $refundAmount,
            'status' => 'refunded',
            'message' => 'Mock refund successfully processed',
        ]);
    }
}
