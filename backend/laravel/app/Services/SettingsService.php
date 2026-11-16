<?php

namespace App\Services;

use App\Models\SystemSetting;
use Illuminate\Support\Facades\DB;

class SettingsService
{
    protected const SECRET_KEY_PATTERN = '/pass(word)?$|secret|api_?key|token|credential/i';

    protected const DEFAULTS = [
        'mikrotik' => [
            'mode' => 'simulator',
            'host' => '192.168.88.1',
            'apiPort' => 8728,
            'apiSslPort' => 8729,
            'username' => 'admin',
            'password' => '',
            'timeoutMs' => 8000,
        ],
        'sms' => [
            'mode' => 'mock',
            'provider' => 'local',
            'providerUrl' => '',
            'apiKey' => '',
            'senderId' => 'NextLink',
        ],
        'payments' => [
            'mode' => 'mock',
            'bkash' => ['appKey' => '', 'appSecret' => '', 'username' => '', 'password' => ''],
            'nagad' => ['merchantId' => '', 'apiKey' => ''],
            'sslcommerz' => ['storeId' => '', 'storePassword' => ''],
            'rocket' => ['merchantId' => '', 'apiKey' => ''],
        ],
        'billing' => [
            'timezone' => 'UTC',
            'dueDay' => 10,
            'lateGraceDays' => 5,
            'suspendAfterDays' => 10,
            'currency' => 'USD',
            'installationFee' => 8.99,
            'installation_fee' => 8.99,
            'taxFee' => 0.99,
            'tax_fee' => 0.99,
            'late_fee_type' => 'percent',
            'late_fee_value' => 10,
            'lateFeeType' => 'percent',
            'lateFeeValue' => 10,
            'lateFeePercent' => 10,
            'lateFee' => 5,
            'rechargeAfterCancelTreatAsNew' => true,
        ],
        'cancellation' => [
            'reasons' => [
                'Too expensive',
                'Slow speed',
                'Frequent disconnections',
                'Moving to another location',
                'Switching provider',
                'Poor support',
                'Temporary pause',
                'Other',
            ],
            'effectiveDateRule' => 'immediate',
            'allowNotSureBuyAgain' => true,
            'rechargeAfterCancelTreatAsNew' => true,
        ],
        'footer' => [
            'version' => 'To be implemented',
        ],
        'notifications' => [
            'invoiceGenerated' => true,
            'paymentReceived' => true,
            'paymentFailed' => true,
            'lateFeeApplied' => true,
            'ticketReply' => true,
            'technicianAssigned' => true,
            'boostActivated' => true,
            'referralCredited' => true,
            'adminNewTicket' => true,
            'adminNewUser' => true,
            'adminFailedPayment' => true,
        ],
    ];

    /**
     * Deep merge helper: source overrides target.
     */
    public static function deepMerge(array $target, array $source): array
    {
        $result = $target;

        foreach ($source as $key => $value) {
            if (is_array($value) && isset($result[$key]) && is_array($result[$key]) && !array_is_list($value)) {
                $result[$key] = self::deepMerge($result[$key], $value);
            } else {
                $result[$key] = $value;
            }
        }

        return $result;
    }

    /**
     * Read all settings merged with defaults.
     */
    public function getAll(): array
    {
        $stored = [];
        $rows = SystemSetting::all();

        foreach ($rows as $row) {
            $val = is_array($row->value) ? $row->value : json_decode($row->value, true);
            if (is_array($val)) {
                $stored[$row->key] = $val;
            }
        }

        return self::deepMerge(self::DEFAULTS, $stored);
    }

    /**
     * Read a single group.
     */
    public function getGroup(string $group): array
    {
        $all = $this->getAll();
        return $all[$group] ?? (self::DEFAULTS[$group] ?? []);
    }

    /**
     * Persist one group of settings.
     */
    public function setGroup(string $group, array $value): array
    {
        $cleaned = $this->stripMaskedSecrets($value);

        if ($group === 'billing' && is_array($cleaned)) {
            $incomingType = $cleaned['late_fee_type'] ?? ($cleaned['lateFeeType'] ?? null);
            if ($incomingType !== null) {
                $normType = strtolower((string)$incomingType) === 'flat' ? 'flat' : 'percent';
                $cleaned['late_fee_type'] = $normType;
                $cleaned['lateFeeType'] = $normType;
            }

            $incomingVal = $cleaned['late_fee_value'] ?? ($cleaned['lateFeeValue'] ?? ($cleaned['lateFeePercent'] ?? null));
            if ($incomingVal !== null && is_numeric($incomingVal) && (float)$incomingVal >= 0) {
                $normVal = (float)$incomingVal;
                $cleaned['late_fee_value'] = $normVal;
                $cleaned['lateFeeValue'] = $normVal;
                $cleaned['lateFeePercent'] = $normVal;
            }

            $incomingInstall = $cleaned['installation_fee'] ?? ($cleaned['installationFee'] ?? null);
            if ($incomingInstall !== null && is_numeric($incomingInstall) && (float)$incomingInstall >= 0) {
                $normInstall = (float)$incomingInstall;
                $cleaned['installationFee'] = $normInstall;
                $cleaned['installation_fee'] = $normInstall;
            }

            $incomingTax = $cleaned['tax_fee'] ?? ($cleaned['taxFee'] ?? null);
            if ($incomingTax !== null && is_numeric($incomingTax) && (float)$incomingTax >= 0) {
                $normTax = (float)$incomingTax;
                $cleaned['taxFee'] = $normTax;
                $cleaned['tax_fee'] = $normTax;
            }
        }

        $current = $this->getGroup($group);
        $merged = self::deepMerge($current, $cleaned);

        SystemSetting::updateOrCreate(
            ['key' => $group],
            [
                'value' => $merged,
                'updated_at' => now(),
            ]
        );

        return $merged;
    }

    /**
     * Strip masked placeholder bullets from payload recursively.
     */
    public function stripMaskedSecrets(mixed $node): mixed
    {
        if (!is_array($node)) {
            return $node;
        }

        $result = [];
        $isList = array_is_list($node);

        foreach ($node as $key => $value) {
            if (is_string($value) && strlen($value) > 0 && preg_match('/^•+$/u', $value)) {
                // Drop masked bullet string so existing secret is kept
                continue;
            }

            if (is_array($value)) {
                $result[$key] = $this->stripMaskedSecrets($value);
            } else {
                $result[$key] = $value;
            }
        }

        return $isList ? array_values($result) : $result;
    }

    /**
     * Mask sensitive credentials with bullets.
     */
    public function maskSecrets(mixed $node): mixed
    {
        if (!is_array($node)) {
            return $node;
        }

        $clone = $node;

        foreach ($clone as $key => $value) {
            if (is_string($value) && preg_match(self::SECRET_KEY_PATTERN, (string)$key)) {
                $clone[$key] = !empty($value) ? '••••••••••••' : '';
                $clone[$key . 'Configured'] = !empty($value);
            } elseif (is_array($value)) {
                $clone[$key] = $this->maskSecrets($value);
            }
        }

        return $clone;
    }

    /**
     * Get masked settings view for staff panel.
     */
    public function getMasked(): array
    {
        $all = $this->getAll();
        $masked = $this->maskSecrets($all);

        $masked['runtime'] = [
            'nodeEnv' => config('app.env', 'production'),
            'mikrotikMode' => env('MIKROTIK_MODE', 'simulator'),
            'smsMode' => env('SMS_MODE', 'mock'),
            'paymentMode' => env('PAYMENT_MODE', 'mock'),
        ];

        return $masked;
    }

    /**
     * Get public non-secret configuration (fees, versions, cancellation reasons).
     */
    public function getPublic(): array
    {
        $all = $this->getAll();

        $lateFeeType = strtolower($all['billing']['late_fee_type'] ?? ($all['billing']['lateFeeType'] ?? 'percent')) === 'flat' ? 'flat' : 'percent';
        $lateFeeValue = (float)($all['billing']['late_fee_value'] ?? ($all['billing']['lateFeeValue'] ?? ($all['billing']['lateFeePercent'] ?? 10)));

        return [
            'success' => true,
            'billing' => [
                'currency' => $all['billing']['currency'] ?? 'USD',
                'dueDay' => (int)($all['billing']['dueDay'] ?? 10),
                'lateGraceDays' => (int)($all['billing']['lateGraceDays'] ?? 5),
                'suspendAfterDays' => (int)($all['billing']['suspendAfterDays'] ?? 10),
                'installationFee' => (float)($all['billing']['installationFee'] ?? 8.99),
                'installation_fee' => (float)($all['billing']['installationFee'] ?? 8.99),
                'taxFee' => (float)($all['billing']['taxFee'] ?? 0.99),
                'tax_fee' => (float)($all['billing']['taxFee'] ?? 0.99),
                'late_fee_type' => $lateFeeType,
                'late_fee_value' => $lateFeeValue,
                'lateFeeType' => $lateFeeType,
                'lateFeeValue' => $lateFeeValue,
                'lateFeePercent' => $lateFeeValue,
                'timezone' => $all['billing']['timezone'] ?? 'UTC',
            ],
            'footer' => [
                'version' => $all['footer']['version'] ?? 'To be implemented',
            ],
            'cancellation' => [
                'reasons' => $all['cancellation']['reasons'] ?? [
                    'Too expensive',
                    'Slow speed',
                    'Frequent disconnections',
                    'Moving to another location',
                    'Switching provider',
                    'Poor support',
                    'Temporary pause',
                    'Other',
                ],
                'effectiveDateRule' => $all['cancellation']['effectiveDateRule'] ?? 'immediate',
                'allowNotSureBuyAgain' => (bool)($all['cancellation']['allowNotSureBuyAgain'] ?? true),
            ],
        ];
    }
}

