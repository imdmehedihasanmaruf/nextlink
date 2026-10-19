<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class SettingsController extends Controller
{
    /** @return array<string, string|null> */
    private function defaults(): array
    {
        return [
            'company.name' => 'Nexlink Internet',
            'company.support_email' => 'hello@nexlink.example',
            'company.phone' => '+880 9612-345678',
            'company.website' => 'https://nexlink.example',
            'company.address' => 'Dhaka, Bangladesh',
            'billing.cycle' => 'monthly',
            'billing.invoice_day' => '1',
            'billing.due_days' => '7',
            'billing.late_fee' => '0',
            'billing.currency' => 'BDT',
            'notifications.invoice_email' => '1',
            'notifications.payment_sms' => '1',
            'notifications.ticket_email' => '1',
            'notifications.overdue_reminder' => '1',
            'sms.provider' => 'none',
            'sms.sender_id' => '',
            'sms.api_endpoint' => '',
            'payments.bkash_enabled' => '0',
            'payments.nagad_enabled' => '0',
            'payments.rocket_enabled' => '0',
            'payments.sslcommerz_enabled' => '0',
            'payments.cash_enabled' => '1',
            'payments.manual_enabled' => '1',
            'coverage.default_district' => 'Dhaka',
            'coverage.check_message' => 'Coverage is available in your area.',
            'security.session_timeout_minutes' => '120',
            'security.require_strong_password' => '1',
            'security.audit_retention_days' => '90',
        ];
    }

    public function index(Request $request): JsonResponse
    {
        abort_unless(in_array($request->user()->role, ['super_admin', 'accounts_billing'], true), 403);

        $stored = DB::table('company_settings')
            ->where('is_secret', false)
            ->orderBy('key')
            ->get(['key', 'value', 'updated_at'])
            ->keyBy('key');

        $items = collect($this->defaults())->map(function (?string $default, string $key) use ($stored) {
            $row = $stored->get($key);

            return [
                'key' => $key,
                'value' => $row?->value ?? $default,
                'updated_at' => $row?->updated_at,
                'is_default' => ! $row,
            ];
        })->values();

        return response()->json(['success' => true, 'data' => $items]);
    }

    public function update(Request $request): JsonResponse
    {
        abort_unless($request->user()->role === 'super_admin', 403);

        $allowed = array_keys($this->defaults());
        $data = $request->validate([
            'settings' => ['required', 'array', 'max:50'],
            'settings.*.key' => ['required', 'string', 'max:120', 'in:'.implode(',', $allowed)],
            'settings.*.value' => ['nullable', 'string', 'max:2000'],
        ]);

        DB::transaction(function () use ($request, $data) {
            foreach ($data['settings'] as $setting) {
                DB::table('company_settings')->updateOrInsert(
                    ['key' => $setting['key']],
                    [
                        'value' => $setting['value'] ?? null,
                        'is_secret' => false,
                        'updated_at' => now(),
                        'created_at' => now(),
                    ]
                );
            }

            DB::table('audit_logs')->insert([
                'user_id' => $request->user()->id,
                'action' => 'settings.updated',
                'record_type' => 'company_settings',
                'record_id' => null,
                'metadata' => json_encode(['keys' => array_column($data['settings'], 'key')]),
                'ip_address' => $request->ip(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        });

        return $this->index($request);
    }
}
