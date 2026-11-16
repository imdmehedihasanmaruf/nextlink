<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\BillingCycle;
use App\Models\BillingEvent;
use App\Models\Cancellation;
use App\Services\BillingEngineService;
use App\Services\SettingsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class BillingController extends Controller
{
    protected BillingEngineService $billingEngine;
    protected SettingsService $settingsService;

    public function __construct(BillingEngineService $billingEngine, SettingsService $settingsService)
    {
        $this->billingEngine = $billingEngine;
        $this->settingsService = $settingsService;
    }

    /**
     * GET /api/billing/overview
     * Aggregate billing metrics for admin dashboard
     */
    public function overview(Request $request): JsonResponse
    {
        $overview = $this->billingEngine->getOverview();
        return response()->json(array_merge(['success' => true], $overview));
    }

    /**
     * GET /api/billing/cycles
     * Historical billing cycle runs
     */
    public function cycles(Request $request): JsonResponse
    {
        $cycles = BillingCycle::orderBy('started_at', 'desc')->take(50)->get();
        return response()->json([
            'success' => true,
            'cycles' => $cycles,
        ]);
    }

    /**
     * POST /api/billing/cycle/run
     * Trigger monthly recurring billing cycle
     */
    public function runCycle(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'period' => ['nullable', 'string', 'regex:/^\d{4}-\d{2}$/'],
            'dryRun' => ['nullable', 'boolean'],
            'background' => ['nullable', 'boolean'],
        ]);

        $period = $validated['period'] ?? now('UTC')->format('Y-m');
        $dryRun = (bool) ($validated['dryRun'] ?? false);

        if (!empty($validated['background'])) {
            $jobId = 'job_' . bin2hex(random_bytes(6));
            AuditLog::create([
                'actor_id' => $request->attributes->get('auth_user')['id'] ?? 'system',
                'actor_role' => $request->attributes->get('auth_user')['role'] ?? 'super_admin',
                'action' => 'billing.cycle_queued',
                'entity_type' => 'billing_cycle',
                'entity_id' => $period,
                'details' => ['jobId' => $jobId],
                'ip_address' => $request->ip(),
            ]);

            return response()->json([
                'success' => true,
                'queued' => true,
                'jobId' => $jobId,
                'period' => $period,
            ], 202);
        }

        $result = $this->billingEngine->runMonthlyCycle([
            'period' => $period,
            'dryRun' => $dryRun,
        ]);

        AuditLog::create([
            'actor_id' => $request->attributes->get('auth_user')['id'] ?? 'system',
            'actor_role' => $request->attributes->get('auth_user')['role'] ?? 'super_admin',
            'action' => 'billing.cycle_run',
            'entity_type' => 'billing_cycle',
            'entity_id' => $period,
            'details' => [
                'invoiceCount' => $result['invoiceCount'] ?? 0,
                'totalAmount' => $result['totalAmount'] ?? 0,
                'dryRun' => $dryRun,
            ],
            'ip_address' => $request->ip(),
        ]);

        return response()->json(array_merge(['success' => true], $result));
    }

    /**
     * POST /api/billing/suspend-overdue
     * Disconnect/suspend subscribers whose unpaid invoices passed grace period
     */
    public function suspendOverdue(Request $request): JsonResponse
    {
        $result = $this->billingEngine->autoSuspendOverdue();

        AuditLog::create([
            'actor_id' => $request->attributes->get('auth_user')['id'] ?? 'system',
            'actor_role' => $request->attributes->get('auth_user')['role'] ?? 'super_admin',
            'action' => 'billing.auto_suspend_overdue',
            'entity_type' => 'billing',
            'details' => $result,
            'ip_address' => $request->ip(),
        ]);

        return response()->json(array_merge(['success' => true], $result));
    }

    /**
     * GET /api/billing/events
     * Billing audit trail / event log
     */
    public function events(Request $request): JsonResponse
    {
        $limit = min(max((int) $request->query('limit', 100), 1), 500);
        $events = BillingEvent::orderBy('created_at', 'desc')->take($limit)->get();

        return response()->json([
            'success' => true,
            'events' => $events,
        ]);
    }

    /**
     * GET /api/billing/cancellations
     * Package cancellation history for staff
     */
    public function cancellations(Request $request): JsonResponse
    {
        $limit = min(max((int) $request->query('limit', 50), 1), 200);
        $offset = max((int) $request->query('offset', 0), 0);
        $search = trim(strtolower((string) $request->query('search', '')));
        $reason = trim((string) $request->query('reason', ''));

        $query = DB::table('cancellations as c')
            ->leftJoin('subscribers as s', 's.id', '=', 'c.subscriber_id')
            ->select('c.*', 's.name as subscriber_name', 's.email as subscriber_email', 's.phone as subscriber_phone');

        if ($search) {
            $query->where(function ($q) use ($search) {
                $term = "%{$search}%";
                $q->whereRaw('LOWER(c.id) LIKE ?', [$term])
                  ->orWhereRaw('LOWER(c.subscriber_id) LIKE ?', [$term])
                  ->orWhereRaw('LOWER(s.name) LIKE ?', [$term])
                  ->orWhereRaw('LOWER(c.package_name) LIKE ?', [$term])
                  ->orWhereRaw('LOWER(c.reason) LIKE ?', [$term])
                  ->orWhereRaw('LOWER(c.description) LIKE ?', [$term]);
            });
        }

        if ($reason && $reason !== 'all') {
            $query->where('c.reason', $reason);
        }

        $total = $query->count();
        $rows = $query->orderBy('c.created_at', 'desc')->offset($offset)->limit($limit)->get();

        return response()->json([
            'success' => true,
            'cancellations' => $rows,
            'total' => $total,
            'limit' => $limit,
            'offset' => $offset,
        ]);
    }

    /**
     * GET /api/billing/quote & POST /api/billing/quote
     * Single source of truth for Subscriber Plan Invoice Preview
     */
    public function quote(Request $request): JsonResponse
    {
        if (
            $request->input('simulateFailure') === true ||
            $request->input('simulateFailure') === 'true' ||
            $request->header('X-Simulate-Quote-Failure') === '1'
        ) {
            return response()->json([
                'success' => false,
                'error' => 'Billing engine quote service is temporarily unavailable. Please retry.',
            ], 503);
        }

        $source = $request->isMethod('GET') ? $request->query() : $request->all();
        $subscriberId = trim((string) ($source['subscriberId'] ?? $source['customerId'] ?? ''));

        // If caller is authenticated as subscriber, enforce tenant boundary
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
                $tokenSubId = $userSubId ?: $userId;
                if ($subscriberId && $subscriberId !== $tokenSubId) {
                    return response()->json([
                        'success' => false,
                        'error' => 'You are not authorized to request a billing quote for another subscriber.',
                    ], 403);
                }
                if (!$subscriberId) {
                    $subscriberId = $tokenSubId;
                }
            }
        }

        if (!$subscriberId) {
            return response()->json([
                'success' => false,
                'error' => 'subscriberId (or customerId) is required to calculate a billing quote.',
            ], 400);
        }

        try {
            $quote = $this->billingEngine->calculateQuote([
                'subscriberId' => $subscriberId,
                'packageId' => $source['packageId'] ?? '',
                'purchaseType' => $source['purchaseType'] ?? 'NEW',
            ]);

            return response()->json([
                'success' => true,
                'quote' => $quote,
                'calculation' => $quote,
            ]);
        } catch (\InvalidArgumentException $e) {
            return response()->json([
                'success' => false,
                'error' => $e->getMessage(),
            ], 400);
        } catch (\Throwable $e) {
            return response()->json([
                'success' => false,
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * GET /api/billing/settings
     * Effective billing configuration
     */
    public function getSettings(Request $request): JsonResponse
    {
        $feeConfig = $this->billingEngine->getFeeConfig();
        return response()->json([
            'success' => true,
            'settings' => [
                'timezone' => $feeConfig['timezone'] ?? 'UTC',
                'dueDay' => $feeConfig['dueDay'],
                'lateGraceDays' => $feeConfig['lateGraceDays'],
                'suspendAfterDays' => $feeConfig['suspendAfterDays'],
                'installationFee' => $feeConfig['installationFee'],
                'installation_fee' => $feeConfig['installationFee'],
                'taxFee' => $feeConfig['taxFee'],
                'tax_fee' => $feeConfig['taxFee'],
                'late_fee_type' => $feeConfig['late_fee_type'],
                'late_fee_value' => $feeConfig['late_fee_value'],
                'lateFeeType' => $feeConfig['lateFeeType'],
                'lateFeeValue' => $feeConfig['lateFeeValue'],
                'lateFeePercent' => $feeConfig['lateFeePercent'],
                'currency' => $feeConfig['currency'] ?? 'USD',
                'currencySymbol' => '$',
                'paymentMode' => 'mock',
            ],
        ]);
    }

    /**
     * PUT /api/billing/settings
     * Update configurable fee parameters
     */
    public function updateSettings(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'installationFee' => ['nullable', 'numeric', 'min:0', 'max:10000'],
            'installation_fee' => ['nullable', 'numeric', 'min:0', 'max:10000'],
            'taxFee' => ['nullable', 'numeric', 'min:0', 'max:10000'],
            'tax_fee' => ['nullable', 'numeric', 'min:0', 'max:10000'],
            'late_fee_type' => ['nullable', 'in:percent,flat'],
            'lateFeeType' => ['nullable', 'in:percent,flat'],
            'late_fee_value' => ['nullable', 'numeric', 'min:0', 'max:10000'],
            'lateFeeValue' => ['nullable', 'numeric', 'min:0', 'max:10000'],
            'lateFeePercent' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'dueDay' => ['nullable', 'integer', 'min:1', 'max:31'],
            'lateGraceDays' => ['nullable', 'integer', 'min:0', 'max:60'],
            'suspendAfterDays' => ['nullable', 'integer', 'min:1', 'max:90'],
            'timezone' => ['nullable', 'string', 'min:1', 'max:60'],
        ]);

        $authUser = $request->attributes->get('auth_user') ?? [];
        $actor = [
            'id' => $authUser['id'] ?? 'system',
            'role' => $authUser['role'] ?? 'super_admin',
            'ip' => $request->ip(),
        ];

        $updated = $this->settingsService->setGroup('billing', $validated, $actor);

        return response()->json([
            'success' => true,
            'settings' => array_merge($updated, [
                'currency' => 'USD',
                'currencySymbol' => '$',
                'paymentMode' => 'mock',
            ]),
        ]);
    }
}
