<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\Invoice;
use App\Models\Package;
use App\Models\Subscriber;
use App\Models\SubscriberBilling;
use App\Models\SubscriberCredential;
use App\Models\UserPreference;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

class SubscriberController
{
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

        // Subscribers are strictly confined to their own ID (SEC-01, IDOR defense)
        if ($userType === 'subscriber' || $userRole === 'subscriber') {
            return $userSubId ?: $userId;
        }

        // Staff may inspect specific subscriber via query parameter
        if ($request->has('subscriberId')) {
            return (string) $request->query('subscriberId');
        }

        return $userSubId ?: $userId;
    }

    /**
     * Sanitize subscriber model/array to ensure zero password or credential leakage (SEC-14).
     */
    protected function sanitizeSubscriber(Subscriber $sub): array
    {
        $arr = $sub->toArray();
        unset($arr['password'], $arr['password_hash'], $arr['legacy_password'], $arr['credentials']);

        if (isset($arr['raw_data']) && is_array($arr['raw_data'])) {
            unset(
                $arr['raw_data']['password'],
                $arr['raw_data']['password_hash'],
                $arr['raw_data']['legacy_password'],
                $arr['raw_data']['tempPassword']
            );
        }

        return $arr;
    }

    /**
     * GET /api/portal/my-summary
     * Outstanding balance, package details, and payment summary for subscriber.
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

        $subscriber = Subscriber::find($subscriberId);
        $package = $subscriber && $subscriber->package_id ? Package::find($subscriber->package_id) : null;

        $raw = $subscriber && is_array($subscriber->raw_data) ? $subscriber->raw_data : [];

        $firstName = $subscriber->first_name ?? ($raw['firstName'] ?? '');
        $lastName = $subscriber->last_name ?? ($raw['lastName'] ?? '');
        if (empty($firstName) && $subscriber) {
            $parts = explode(' ', trim($subscriber->name ?? ''));
            $firstName = $parts[0] ?? '';
            $lastName = count($parts) > 1 ? implode(' ', array_slice($parts, 1)) : '';
        }

        $invoices = Invoice::where('subscriber_id', $subscriberId)->get();
        $unpaidInvoices = $invoices->where('status', 'unpaid');
        $paidInvoices = $invoices->where('status', 'paid');

        $outstanding = (float) $unpaidInvoices->sum('amount');
        $unpaidCount = $unpaidInvoices->count();
        $paidCount = $paidInvoices->count();
        $paidTotal = (float) $paidInvoices->sum('amount');

        $nextDue = $unpaidInvoices->sortBy('due_date')->first();

        $currentPeriod = date('Y-m');
        $isCurrentPeriodPaid = $paidInvoices->filter(function ($inv) use ($currentPeriod) {
            $invRaw = is_array($inv->raw_data) ? $inv->raw_data : [];
            return ($invRaw['period'] ?? '') === $currentPeriod || str_starts_with((string) $inv->due_date, $currentPeriod);
        })->isNotEmpty() && $unpaidCount === 0;

        $nextDueDateFormatted = date('10/m/Y', strtotime('+1 month'));
        $paidMonthYear = date('F Y');

        $subscriberObj = $subscriber ? [
            'id' => $subscriber->id,
            'name' => $subscriber->name,
            'firstName' => $firstName,
            'lastName' => $lastName,
            'phone' => $subscriber->phone,
            'email' => $subscriber->email,
            'status' => $subscriber->status,
            'packageId' => $subscriber->package_id,
            'packageName' => $package ? $package->name : ($raw['packageName'] ?? ''),
            'packagePrice' => $package ? (float) $package->price : (float) ($raw['price'] ?? 0),
            'downloadSpeed' => $package ? (int) $package->speed : (int) ($raw['downloadSpeed'] ?? 0),
            'uploadSpeed' => $package ? (int) $package->upload_speed : (int) ($raw['uploadSpeed'] ?? 0),
            'creditBalance' => (float) ($raw['credit_balance'] ?? 0),
            'referralReward' => (float) ($raw['referralReward'] ?? 0),
        ] : null;

        $effectiveNextInvoice = $nextDue ? [
            'id' => $nextDue->id,
            'due_date' => $nextDue->due_date,
            'amount' => (float) $nextDue->amount,
            'isEstimated' => false,
        ] : [
            'id' => null,
            'due_date' => date('Y-m-10', strtotime('+1 month')),
            'amount' => $package ? (float) $package->price : 0,
            'isEstimated' => true,
        ];

        return response()->json([
            'success' => true,
            'subscriber' => $subscriberObj,
            'subscriberId' => $subscriber ? $subscriber->id : $subscriberId,
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

    /**
     * GET /api/users & GET /api/subscribers
     * List subscribers for staff panel with sensitive fields stripped.
     */
    public function index(Request $request): JsonResponse
    {
        $subscribers = Subscriber::with('package')
            ->orderBy('created_at', 'desc')
            ->get()
            ->map(fn (Subscriber $s) => $this->sanitizeSubscriber($s))
            ->values();

        return response()->json([
            'success' => true,
            'users' => $subscribers,
            'subscribers' => $subscribers,
        ]);
    }

    /**
     * POST /api/users & POST /api/subscribers
     * Create subscriber account (staff only).
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'id' => 'nullable|string|max:100',
            'firstName' => 'nullable|string|max:120',
            'lastName' => 'nullable|string|max:120',
            'name' => 'nullable|string|max:255',
            'email' => 'nullable|email|max:255',
            'phone' => 'required|string|min:5|max:60',
            'address' => 'nullable|string|max:500',
            'zone' => 'nullable|string|max:120',
            'packageId' => 'nullable|string|max:100',
            'status' => 'nullable|string|in:active,registered,suspended,cancelled,inactive',
            'password' => 'nullable|string|min:6|max:120',
        ]);

        $firstName = trim((string) ($validated['firstName'] ?? ''));
        $lastName = trim((string) ($validated['lastName'] ?? ''));
        $fullName = trim((string) ($validated['name'] ?? trim("{$firstName} {$lastName}")));

        if ($fullName === '') {
            return response()->json([
                'success' => false,
                'error' => 'Subscriber name or firstName is required',
            ], 400);
        }

        if ($firstName === '') {
            $parts = preg_split('/\s+/', $fullName, 2);
            $firstName = $parts[0] ?? 'Subscriber';
            $lastName = $parts[1] ?? '';
        }

        $subscriberId = !empty($validated['id'])
            ? $validated['id']
            : ('NL-' . date('Y') . '-' . strtoupper(substr(bin2hex(random_bytes(4)), 0, 8)));

        if (Subscriber::where('id', $subscriberId)->exists()) {
            return response()->json([
                'success' => false,
                'error' => 'A subscriber with this ID already exists',
            ], 409);
        }

        $tempPassword = !empty($validated['password'])
            ? $validated['password']
            : ('Pass' . random_int(100000, 999999) . '!');

        $pkg = !empty($validated['packageId']) ? Package::find($validated['packageId']) : null;
        $status = $validated['status'] ?? ($pkg ? 'active' : 'registered');

        $user = $request->attributes->get('user') ?? $request->user();
        $actorId = is_object($user) ? ($user->id ?? 'staff') : ($user['id'] ?? 'staff');
        $actorRole = is_object($user) ? ($user->role ?? 'staff') : ($user['role'] ?? 'staff');

        $subscriber = DB::transaction(function () use (
            $subscriberId,
            $firstName,
            $lastName,
            $fullName,
            $validated,
            $pkg,
            $status,
            $tempPassword,
            $actorId,
            $actorRole,
            $request
        ) {
            $sub = Subscriber::create([
                'id' => $subscriberId,
                'first_name' => $firstName,
                'last_name' => $lastName,
                'name' => $fullName,
                'email' => $validated['email'] ?? null,
                'phone' => $validated['phone'],
                'package_id' => $pkg ? $pkg->id : ($validated['packageId'] ?? null),
                'status' => $status,
                'raw_data' => [
                    'firstName' => $firstName,
                    'lastName' => $lastName,
                    'address' => $validated['address'] ?? '',
                    'zone' => $validated['zone'] ?? '',
                    'packageId' => $pkg ? $pkg->id : ($validated['packageId'] ?? null),
                    'packageName' => $pkg ? $pkg->name : '',
                ],
            ]);

            $candidateUsername = $validated['email'] ?? ($validated['phone'] ?: $subscriberId);
            if (SubscriberCredential::where('username', $candidateUsername)->exists()) {
                $candidateUsername = $subscriberId;
            }

            SubscriberCredential::create([
                'subscriber_id' => $subscriberId,
                'username' => $candidateUsername,
                'password_hash' => Hash::make($tempPassword),
                'legacy_password' => null,
                'migrated_at' => now(),
            ]);

            SubscriberBilling::updateOrCreate(
                ['subscriber_id' => $subscriberId],
                [
                    'package_id' => $pkg ? $pkg->id : ($validated['packageId'] ?? null),
                    'amount' => $pkg ? (float) $pkg->price : 0.0,
                    'currency' => 'USD',
                    'billing_start' => date('Y-m-01'),
                    'billing_end' => date('Y-m-t'),
                    'next_invoice_date' => date('Y-m-01', strtotime('+1 month')),
                    'auto_disconnect' => true,
                    'status' => $status === 'active' ? 'active' : 'inactive',
                ]
            );

            AuditLog::create([
                'actor_id' => $actorId,
                'actor_role' => $actorRole,
                'action' => 'subscriber.created',
                'entity_type' => 'subscriber',
                'entity_id' => $subscriberId,
                'details' => [
                    'packageId' => $sub->package_id,
                    'status' => $sub->status,
                ],
                'ip_address' => $request->ip(),
                'created_at' => now(),
            ]);

            return $sub;
        });

        return response()->json([
            'success' => true,
            'message' => 'User created',
            'user' => $this->sanitizeSubscriber($subscriber),
            'temporaryPassword' => $tempPassword,
        ], 201);
    }

    /**
     * PUT /api/users & PUT /api/users/{id}
     * Update subscriber record (staff only).
     */
    public function updateUser(Request $request, ?string $id = null): JsonResponse
    {
        $targetId = $id ?? $request->input('id');
        if (empty($targetId)) {
            return response()->json(['success' => false, 'error' => 'Subscriber id is required'], 400);
        }

        $subscriber = Subscriber::find($targetId);
        if (!$subscriber) {
            return response()->json(['success' => false, 'error' => 'Subscriber not found'], 404);
        }

        $validated = $request->validate([
            'firstName' => 'nullable|string|max:120',
            'lastName' => 'nullable|string|max:120',
            'name' => 'nullable|string|max:255',
            'email' => 'nullable|email|max:255',
            'phone' => 'nullable|string|max:60',
            'address' => 'nullable|string|max:500',
            'zone' => 'nullable|string|max:120',
            'packageId' => 'nullable|string|max:100',
            'status' => 'nullable|string|in:active,registered,suspended,cancelled,inactive',
        ]);

        $user = $request->attributes->get('user') ?? $request->user();
        $actorId = is_object($user) ? ($user->id ?? 'staff') : ($user['id'] ?? 'staff');
        $actorRole = is_object($user) ? ($user->role ?? 'staff') : ($user['role'] ?? 'staff');

        DB::transaction(function () use ($subscriber, $validated, $actorId, $actorRole, $request) {
            $raw = is_array($subscriber->raw_data) ? $subscriber->raw_data : [];

            if (array_key_exists('firstName', $validated) && $validated['firstName'] !== null) {
                $subscriber->first_name = $validated['firstName'];
                $raw['firstName'] = $validated['firstName'];
            }
            if (array_key_exists('lastName', $validated) && $validated['lastName'] !== null) {
                $subscriber->last_name = $validated['lastName'];
                $raw['lastName'] = $validated['lastName'];
            }
            if (!empty($validated['name'])) {
                $subscriber->name = $validated['name'];
            } elseif (isset($validated['firstName']) || isset($validated['lastName'])) {
                $computed = trim(($subscriber->first_name ?? '') . ' ' . ($subscriber->last_name ?? ''));
                if ($computed !== '') {
                    $subscriber->name = $computed;
                }
            }

            if (array_key_exists('email', $validated)) {
                $subscriber->email = $validated['email'];
            }
            if (array_key_exists('phone', $validated) && $validated['phone'] !== null) {
                $subscriber->phone = $validated['phone'];
            }
            if (array_key_exists('address', $validated) && $validated['address'] !== null) {
                $raw['address'] = $validated['address'];
            }
            if (array_key_exists('zone', $validated) && $validated['zone'] !== null) {
                $raw['zone'] = $validated['zone'];
            }
            if (array_key_exists('status', $validated) && $validated['status'] !== null) {
                $subscriber->status = $validated['status'];
            }
            if (array_key_exists('packageId', $validated) && $validated['packageId'] !== null) {
                $subscriber->package_id = $validated['packageId'];
                $pkg = Package::find($validated['packageId']);
                if ($pkg) {
                    $raw['packageId'] = $pkg->id;
                    $raw['packageName'] = $pkg->name;
                    SubscriberBilling::updateOrCreate(
                        ['subscriber_id' => $subscriber->id],
                        [
                            'package_id' => $pkg->id,
                            'amount' => (float) $pkg->price,
                        ]
                    );
                }
            }

            unset($raw['password'], $raw['password_hash'], $raw['legacy_password'], $raw['tempPassword']);
            $subscriber->raw_data = $raw;
            $subscriber->save();

            AuditLog::create([
                'actor_id' => $actorId,
                'actor_role' => $actorRole,
                'action' => 'subscriber.updated',
                'entity_type' => 'subscriber',
                'entity_id' => $subscriber->id,
                'details' => ['updatedFields' => array_keys($validated)],
                'ip_address' => $request->ip(),
                'created_at' => now(),
            ]);
        });

        return response()->json([
            'success' => true,
            'message' => 'User updated successfully',
            'user' => $this->sanitizeSubscriber($subscriber->fresh()),
        ]);
    }

    /**
     * DELETE /api/users & DELETE /api/users/{id}
     */
    public function destroyUser(Request $request, ?string $id = null): JsonResponse
    {
        $targetId = $id ?? $request->input('id') ?? $request->query('id');
        if (empty($targetId)) {
            return response()->json(['success' => false, 'error' => 'Subscriber id is required'], 400);
        }

        $subscriber = Subscriber::find($targetId);
        if (!$subscriber) {
            return response()->json(['success' => false, 'error' => 'Subscriber not found'], 404);
        }

        $user = $request->attributes->get('user') ?? $request->user();
        $actorId = is_object($user) ? ($user->id ?? 'staff') : ($user['id'] ?? 'staff');
        $actorRole = is_object($user) ? ($user->role ?? 'staff') : ($user['role'] ?? 'staff');

        DB::transaction(function () use ($subscriber, $targetId, $actorId, $actorRole, $request) {
            SubscriberCredential::where('subscriber_id', $targetId)->delete();
            SubscriberBilling::where('subscriber_id', $targetId)->delete();
            $subscriber->delete();

            AuditLog::create([
                'actor_id' => $actorId,
                'actor_role' => $actorRole,
                'action' => 'subscriber.deleted',
                'entity_type' => 'subscriber',
                'entity_id' => $targetId,
                'details' => ['id' => $targetId],
                'ip_address' => $request->ip(),
                'created_at' => now(),
            ]);
        });

        return response()->json([
            'success' => true,
            'message' => 'User deleted successfully',
        ]);
    }

    /**
     * GET /api/customer/profile & GET /api/portal/profile
     */
    public function profile(Request $request): JsonResponse
    {
        $subscriberId = $this->resolveSubscriberId($request);

        if (!$subscriberId) {
            return response()->json(['success' => false, 'error' => 'Authentication required'], 401);
        }

        $subscriber = Subscriber::find($subscriberId);
        if (!$subscriber) {
            return response()->json(['success' => false, 'error' => 'Subscriber not found'], 404);
        }

        $raw = is_array($subscriber->raw_data) ? $subscriber->raw_data : [];

        return response()->json([
            'success' => true,
            'user' => [
                'id' => $subscriber->id,
                'firstName' => $subscriber->first_name ?? ($raw['firstName'] ?? ''),
                'lastName' => $subscriber->last_name ?? ($raw['lastName'] ?? ''),
                'name' => $subscriber->name,
                'email' => $subscriber->email,
                'phone' => $subscriber->phone,
                'address' => $raw['address'] ?? '',
                'packageId' => $subscriber->package_id,
                'status' => $subscriber->status,
            ],
        ]);
    }

    /**
     * POST /api/customer/profile & POST /api/portal/profile
     */
    public function updateProfile(Request $request): JsonResponse
    {
        $subscriberId = $this->resolveSubscriberId($request);

        if (!$subscriberId) {
            return response()->json(['success' => false, 'error' => 'Authentication required'], 401);
        }

        $validated = $request->validate([
            'firstName' => 'nullable|string|max:120',
            'lastName' => 'nullable|string|max:120',
            'email' => 'nullable|email|max:255',
            'phone' => 'nullable|string|max:40',
            'address' => 'nullable|string|max:500',
        ]);

        $subscriber = Subscriber::find($subscriberId);
        if (!$subscriber) {
            return response()->json(['success' => false, 'error' => 'Subscriber not found'], 404);
        }

        if (array_key_exists('firstName', $validated) && $validated['firstName'] !== null) {
            $subscriber->first_name = $validated['firstName'];
        }
        if (array_key_exists('lastName', $validated) && $validated['lastName'] !== null) {
            $subscriber->last_name = $validated['lastName'];
        }
        if (array_key_exists('email', $validated) && $validated['email'] !== null) {
            $subscriber->email = $validated['email'];
        }
        if (array_key_exists('phone', $validated) && $validated['phone'] !== null) {
            $subscriber->phone = $validated['phone'];
        }

        $fullName = trim(($subscriber->first_name ?? '') . ' ' . ($subscriber->last_name ?? ''));
        if ($fullName !== '') {
            $subscriber->name = $fullName;
        }

        $raw = is_array($subscriber->raw_data) ? $subscriber->raw_data : [];
        if (array_key_exists('address', $validated) && $validated['address'] !== null) {
            $raw['address'] = $validated['address'];
        }
        unset($raw['password'], $raw['password_hash'], $raw['legacy_password'], $raw['tempPassword']);
        $subscriber->raw_data = $raw;
        $subscriber->save();

        return response()->json([
            'success' => true,
            'message' => 'Profile saved.',
            'user' => $this->sanitizeSubscriber($subscriber),
        ]);
    }

    /**
     * Format UserPreference record into consistent camelCase payload.
     */
    protected function formatPreferences(?UserPreference $pref, string $subscriberId, ?string $fallbackTheme = null): array
    {
        return [
            'userId' => $subscriberId,
            'theme' => $pref ? ($pref->theme ?? 'system') : ($fallbackTheme ?? 'system'),
            'themeColor' => $pref ? ($pref->theme_color ?? 'blue') : 'blue',
            'fontSize' => $pref ? ($pref->font_size ?? 'md') : 'md',
            'language' => $pref ? ($pref->language ?? 'en') : 'en',
            'autoSave' => $pref ? (bool) ($pref->auto_save ?? true) : true,
        ];
    }

    /**
     * GET /api/portal/preferences
     */
    public function preferences(Request $request): JsonResponse
    {
        $subscriberId = $this->resolveSubscriberId($request);

        if (!$subscriberId) {
            return response()->json(['success' => false, 'error' => 'Authentication required'], 401);
        }

        $pref = UserPreference::find($subscriberId);
        $sub = Subscriber::find($subscriberId);
        $formatted = $this->formatPreferences($pref, $subscriberId, $sub ? $sub->theme : 'system');

        return response()->json([
            'success' => true,
            'preferences' => $formatted,
            'theme' => $formatted['theme'],
        ]);
    }

    /**
     * PATCH /api/portal/preferences & POST /api/portal/preferences
     * Partial-safe update with validation and DB transaction (DB-05).
     */
    public function updatePreferences(Request $request): JsonResponse
    {
        $subscriberId = $this->resolveSubscriberId($request);

        if (!$subscriberId) {
            return response()->json(['success' => false, 'error' => 'Authentication required'], 401);
        }

        $validated = $request->validate([
            'theme' => 'nullable|string|in:light,dark,system',
            'themeColor' => 'nullable|string|max:30',
            'fontSize' => 'nullable|string|in:sm,md,lg',
            'language' => 'nullable|string|max:10',
            'autoSave' => 'nullable|boolean',
        ]);

        $existing = UserPreference::find($subscriberId);

        $theme = $validated['theme'] ?? ($existing ? $existing->theme : 'system');
        $themeColor = $validated['themeColor'] ?? ($existing ? $existing->theme_color : 'blue');
        $fontSize = $validated['fontSize'] ?? ($existing ? $existing->font_size : 'md');
        $language = $validated['language'] ?? ($existing ? $existing->language : 'en');
        $autoSave = array_key_exists('autoSave', $validated) && $validated['autoSave'] !== null
            ? (bool) $validated['autoSave']
            : ($existing ? (bool) $existing->auto_save : true);

        $pref = DB::transaction(function () use ($subscriberId, $theme, $themeColor, $fontSize, $language, $autoSave, $validated, $request) {
            $saved = UserPreference::updateOrCreate(
                ['user_id' => $subscriberId],
                [
                    'theme' => $theme,
                    'theme_color' => $themeColor,
                    'font_size' => $fontSize,
                    'language' => $language,
                    'auto_save' => $autoSave,
                    'updated_at' => now(),
                ]
            );

            $sub = Subscriber::find($subscriberId);
            if ($sub && isset($validated['theme'])) {
                $sub->theme = $validated['theme'];
                $sub->save();
            }

            AuditLog::create([
                'actor_id' => $subscriberId,
                'actor_role' => 'subscriber',
                'action' => 'subscriber_preferences_updated',
                'entity_type' => 'user_preference',
                'entity_id' => $subscriberId,
                'details' => [
                    'theme' => $theme,
                    'themeColor' => $themeColor,
                    'fontSize' => $fontSize,
                    'language' => $language,
                    'autoSave' => $autoSave,
                ],
                'ip_address' => $request->ip(),
                'created_at' => now(),
            ]);

            return $saved;
        });

        $formatted = $this->formatPreferences($pref, $subscriberId);

        return response()->json([
            'success' => true,
            'preferences' => $formatted,
            'theme' => $formatted['theme'],
        ]);
    }
}
