<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\BillingEvent;
use App\Models\Invoice;
use App\Models\PaymentTransaction;
use App\Models\Subscriber;
use App\Services\BillingEngineService;
use App\Services\PdfInvoiceService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class InvoiceController extends Controller
{
    protected PdfInvoiceService $pdfService;
    protected BillingEngineService $billingEngine;

    public function __construct(PdfInvoiceService $pdfService, BillingEngineService $billingEngine)
    {
        $this->pdfService = $pdfService;
        $this->billingEngine = $billingEngine;
    }

    /**
     * Resolve principal subscriber ID from JWT identity or query
     */
    protected function resolveSubscriberId(Request $request): ?string
    {
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
        if ($user) {
            $userRole = is_object($user) ? ($user->role ?? null) : ($user['role'] ?? null);
            $userType = is_object($user) ? ($user->type ?? null) : ($user['type'] ?? null);
            $userId = is_object($user) ? ($user->id ?? null) : ($user['id'] ?? null);
            $userSubId = is_object($user) ? ($user->subscriberId ?? null) : ($user['subscriberId'] ?? null);

            if ($userType === 'subscriber' || $userRole === 'subscriber') {
                return $userSubId ?: $userId;
            }

            if ($request->has('subscriberId') && !empty($request->query('subscriberId'))) {
                return trim((string) $request->query('subscriberId'));
            }
            if ($request->has('subscriberId') && !empty($request->input('subscriberId'))) {
                return trim((string) $request->input('subscriberId'));
            }

            return $userSubId ?: $userId;
        }

        return null;
    }

    /**
     * GET /api/billing/invoices
     * Paginated invoice list with subscriber details
     */
    public function index(Request $request): JsonResponse
    {
        $status = $request->query('status');
        $subscriberId = $request->query('subscriberId');
        $limit = min(max((int) $request->query('limit', 100), 1), 500);
        $offset = max((int) $request->query('offset', 0), 0);

        $query = DB::table('invoices as i')
            ->leftJoin('subscribers as s', 's.id', '=', 'i.subscriber_id')
            ->select('i.*', 's.name as subscriber_name', 's.phone as subscriber_phone', 's.email as subscriber_email');

        if ($status && $status !== 'all') {
            $query->where('i.status', $status);
        }
        if ($subscriberId) {
            $query->where('i.subscriber_id', $subscriberId);
        }

        $total = $query->count();
        $invoices = $query->orderBy('i.created_at', 'desc')->offset($offset)->limit($limit)->get();

        $invoices = $invoices->map(function ($inv) {
            if (isset($inv->raw_data) && is_string($inv->raw_data)) {
                $inv->raw_data = json_decode($inv->raw_data, true);
            }
            return $inv;
        });

        return response()->json([
            'success' => true,
            'invoices' => $invoices,
            'total' => $total,
            'limit' => $limit,
            'offset' => $offset,
        ]);
    }

    /**
     * GET /api/billing/invoices/{id}
     * Single invoice with full details, events, and transactions
     */
    public function show(Request $request, string $id): JsonResponse
    {
        $invoice = DB::table('invoices as i')
            ->leftJoin('subscribers as s', 's.id', '=', 'i.subscriber_id')
            ->select('i.*', 's.name as subscriber_name', 's.phone as subscriber_phone', 's.email as subscriber_email')
            ->where('i.id', $id)
            ->first();

        if (!$invoice) {
            return response()->json([
                'success' => false,
                'error' => 'Invoice not found',
            ], 404);
        }

        if (isset($invoice->raw_data) && is_string($invoice->raw_data)) {
            $invoice->raw_data = json_decode($invoice->raw_data, true);
        }

        $events = BillingEvent::where('invoice_id', $id)->orderBy('created_at', 'desc')->get();
        $transactions = PaymentTransaction::where('invoice_id', $id)->orderBy('created_at', 'desc')->get();

        return response()->json([
            'success' => true,
            'invoice' => $invoice,
            'events' => $events,
            'transactions' => $transactions,
        ]);
    }

    /**
     * GET /api/billing/invoices/{id}/pdf
     * Download or stream auto-generated PDF invoice
     */
    public function pdf(Request $request, string $id): Response|JsonResponse
    {
        $invoice = Invoice::find($id);
        if (!$invoice) {
            return response()->json([
                'success' => false,
                'error' => 'Invoice not found',
            ], 404);
        }

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
        $userType = is_object($user) ? ($user->type ?? null) : ($user['type'] ?? null);
        $userId = is_object($user) ? ($user->id ?? null) : ($user['id'] ?? null);
        $userSubId = is_object($user) ? ($user->subscriberId ?? null) : ($user['subscriberId'] ?? null);

        if ($userType === 'subscriber' || $userRole === 'subscriber') {
            $effectiveSubId = $userSubId ?: $userId;
            if ($invoice->subscriber_id !== $effectiveSubId) {
                return response()->json([
                    'success' => false,
                    'error' => 'You can only view your own invoices',
                ], 403);
            }
        } elseif (!in_array($userRole, ['super_admin', 'billing'], true)) {
            return response()->json([
                'success' => false,
                'error' => 'You are not allowed to view the billing documents',
            ], 403);
        }

        $pdfBytes = $this->pdfService->generateInvoicePdf($invoice);

        AuditLog::create([
            'actor_id' => $userId ?? 'system',
            'actor_role' => $userRole ?? 'super_admin',
            'action' => 'invoice.pdf_downloaded',
            'entity_type' => 'invoice',
            'entity_id' => $invoice->id,
            'ip_address' => $request->ip(),
        ]);

        return response($pdfBytes, 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => "inline; filename=\"{$invoice->id}.pdf\"",
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    /**
     * DELETE /api/billing/invoices/{id}
     * Remove an invoice and its payment records (admin action)
     */
    public function destroy(Request $request, string $id): JsonResponse
    {
        $invoice = Invoice::find($id);
        if (!$invoice) {
            return response()->json([
                'success' => false,
                'error' => 'Invoice not found',
            ], 404);
        }

        $isCancel = strtolower((string) ($invoice->invoice_type ?? $invoice->raw_data['invoiceType'] ?? '')) === 'cancel'
            || str_contains((string) $invoice->id, 'CANCEL');

        if ($isCancel) {
            return response()->json([
                'success' => false,
                'error' => 'Cancelled invoices cannot be deleted. Cancellation and audit records are permanently retained.',
            ], 403);
        }

        if (strtolower((string) $invoice->status) === 'paid') {
            return response()->json([
                'success' => false,
                'error' => 'A paid invoice cannot be deleted. Revenue records are preserved.',
            ], 409);
        }

        DB::transaction(function () use ($invoice) {
            PaymentTransaction::where('invoice_id', $invoice->id)->delete();
            BillingEvent::where('invoice_id', $invoice->id)->delete();
            $invoice->delete();
        });

        $authUser = $request->attributes->get('auth_user') ?? [];
        AuditLog::create([
            'actor_id' => $authUser['id'] ?? 'system',
            'actor_role' => $authUser['role'] ?? 'super_admin',
            'action' => 'invoice.deleted',
            'entity_type' => 'invoice',
            'entity_id' => $id,
            'ip_address' => $request->ip(),
        ]);

        return response()->json([
            'success' => true,
            'message' => "Invoice {$id} deleted",
        ]);
    }

    /**
     * GET /api/billing/my-invoices & /api/portal/my-invoices
     * The authenticated subscriber's own invoices only (strict tenant isolation)
     */
    public function myInvoices(Request $request): JsonResponse
    {
        $subscriberId = $this->resolveSubscriberId($request);
        if (!$subscriberId) {
            return response()->json([
                'success' => false,
                'error' => 'Authentication required. Please sign in to view your bills.',
            ], 401);
        }

        $invoices = DB::table('invoices as i')
            ->leftJoin('subscribers as s', 's.id', '=', 'i.subscriber_id')
            ->leftJoin('packages as p', 'p.id', '=', 's.package_id')
            ->select(
                'i.id',
                'i.subscriber_id',
                'i.amount',
                'i.installation_fee',
                'i.tax_fee',
                'i.late_fee',
                'i.carried_over_amount',
                'i.late_fee_applied',
                'i.status',
                'i.due_date',
                'i.raw_data',
                'i.created_at',
                'i.updated_at',
                DB::raw("COALESCE(p.name, i.raw_data->>'packageName', 'Standard Fiber') as package_name"),
                DB::raw("COALESCE(p.speed, (i.raw_data->>'packageSpeed')::int, 200) as package_speed"),
                DB::raw("COALESCE(p.price, (i.raw_data->>'packagePrice')::numeric, 29.99) as package_price")
            )
            ->where('i.subscriber_id', $subscriberId)
            ->orderBy('i.created_at', 'desc')
            ->limit(100)
            ->get();

        $invoices = $invoices->map(function ($inv) {
            if (isset($inv->raw_data) && is_string($inv->raw_data)) {
                $inv->raw_data = json_decode($inv->raw_data, true);
            }
            return $inv;
        });

        $transactions = DB::table('payment_transactions')
            ->select('id', 'invoice_id', 'gateway', 'amount', 'status', 'gateway_txn_id', 'created_at')
            ->where('subscriber_id', $subscriberId)
            ->orderBy('created_at', 'desc')
            ->limit(50)
            ->get();

        return response()->json([
            'success' => true,
            'invoices' => $invoices,
            'transactions' => $transactions,
        ]);
    }

    /**
     * GET /api/billing/my-summary & /api/portal/my-summary
     * Outstanding balance and next due date for the subscriber
     */
    public function mySummary(Request $request): JsonResponse
    {
        $subscriberId = $this->resolveSubscriberId($request);
        if (!$subscriberId) {
            return response()->json([
                'success' => false,
                'error' => 'Authentication required. Please sign in to view your billing summary.',
            ], 401);
        }

        $totalsRow = DB::selectOne("
            SELECT
                COALESCE(SUM(amount) FILTER (WHERE status = 'unpaid'), 0)::numeric AS outstanding,
                COUNT(*) FILTER (WHERE status = 'unpaid')::int                      AS unpaid_count,
                COUNT(*) FILTER (WHERE status = 'paid')::int                        AS paid_count,
                COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0)::numeric    AS paid_total
            FROM invoices
            WHERE subscriber_id = ?
        ", [$subscriberId]);

        $outstanding = (float) ($totalsRow->outstanding ?? 0);
        $unpaidCount = (int) ($totalsRow->unpaid_count ?? 0);
        $paidCount = (int) ($totalsRow->paid_count ?? 0);
        $paidTotal = (float) ($totalsRow->paid_total ?? 0);

        $nextDue = DB::table('invoices')
            ->select('id', 'due_date', 'amount')
            ->where('subscriber_id', $subscriberId)
            ->where('status', 'unpaid')
            ->whereNotNull('due_date')
            ->where('due_date', '<>', '')
            ->orderBy('due_date', 'asc')
            ->first();

        $currentPeriod = now('UTC')->format('Y-m');
        $currentPeriodPaidRow = DB::table('invoices')
            ->where('subscriber_id', $subscriberId)
            ->where('status', 'paid')
            ->where(function ($q) use ($currentPeriod) {
                $q->whereRaw("raw_data->>'period' = ?", [$currentPeriod])
                  ->orWhere('due_date', 'LIKE', "{$currentPeriod}%");
            })
            ->first();

        $isCurrentPeriodPaid = (bool) $currentPeriodPaidRow && $unpaidCount === 0;

        $dt = Carbon::createFromFormat('Y-m', $currentPeriod, 'UTC');
        $nextMonth = $dt->copy()->addMonth();
        $nextPeriod = $nextMonth->format('Y-m');
        $billingCfg = $this->billingEngine->getBillingConfig();
        $nextDueDateRaw = $this->billingEngine->dueDateForPeriod($nextPeriod, $billingCfg['dueDay']);

        $nextDueDateParts = explode('-', $nextDueDateRaw);
        $nextDueDateFormatted = count($nextDueDateParts) === 3
            ? "{$nextDueDateParts[2]}/{$nextDueDateParts[1]}/{$nextDueDateParts[0]}"
            : $nextDueDateRaw;

        $paidMonthYear = $dt->format('F Y');

        $subscriber = DB::table('subscribers as s')
            ->leftJoin('packages as p', 'p.id', '=', 's.package_id')
            ->select(
                's.id', 's.name', 's.first_name', 's.last_name', 's.phone', 's.email', 's.status', 's.package_id', 's.raw_data',
                'p.name as joined_package_name', 'p.price as joined_package_price',
                'p.speed as joined_download_speed', 'p.upload_speed as joined_upload_speed'
            )
            ->where('s.id', $subscriberId)
            ->first();

        $raw = [];
        if ($subscriber && isset($subscriber->raw_data)) {
            $raw = is_string($subscriber->raw_data) ? json_decode($subscriber->raw_data, true) : (array) $subscriber->raw_data;
        }

        $effectiveNextInvoice = $nextDue ? [
            'id' => $nextDue->id,
            'due_date' => $nextDue->due_date,
            'amount' => (float) $nextDue->amount,
            'isEstimated' => false,
        ] : [
            'id' => null,
            'due_date' => $raw['dueDate'] ?? $raw['nextBillingDate'] ?? $nextDueDateRaw,
            'amount' => (float) ($subscriber->joined_package_price ?? 0),
            'isEstimated' => true,
        ];

        $subscriberObj = $subscriber ? [
            'id' => $subscriber->id,
            'name' => $subscriber->name,
            'firstName' => $subscriber->first_name ?? ($raw['firstName'] ?? ''),
            'lastName' => $subscriber->last_name ?? ($raw['lastName'] ?? ''),
            'phone' => $subscriber->phone,
            'email' => $subscriber->email,
            'status' => $subscriber->status,
            'packageId' => $subscriber->package_id,
            'packageName' => $subscriber->joined_package_name ?? ($raw['packageName'] ?? ''),
            'packagePrice' => (float) ($subscriber->joined_package_price ?? 0),
            'downloadSpeed' => (int) ($subscriber->joined_download_speed ?? 0),
            'uploadSpeed' => (int) ($subscriber->joined_upload_speed ?? 0),
            'creditBalance' => (float) ($raw['credit_balance'] ?? 0),
            'referralReward' => (float) ($raw['referralReward'] ?? 0),
        ] : null;

        return response()->json([
            'success' => true,
            'subscriber' => $subscriberObj,
            'subscriberId' => $subscriber->id ?? $subscriberId,
            'summary' => [
                'outstanding' => $outstanding,
                'unpaidCount' => $unpaidCount,
                'paidCount' => $paidCount,
                'paidTotal' => $paidTotal,
                'nextInvoice' => $effectiveNextInvoice,
                'isCurrentPeriodPaid' => $isCurrentPeriodPaid,
                'alreadyPaid' => $isCurrentPeriodPaid,
                'paidMonthYear' => $paidMonthYear,
                'nextDueDate' => $nextDueDateFormatted,
                'paidNotice' => "Paid for {$paidMonthYear}. Next due: {$nextDueDateFormatted}",
                'subscriber' => $subscriberObj,
            ],
        ]);
    }
}
