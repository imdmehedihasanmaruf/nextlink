<?php

namespace App\Models;

use Illuminate\Support\Facades\DB;
use PDO;

class TestDatabaseManager
{
    private static bool $provisionedInProcess = false;

    public const ORDERED_TABLES = [
        'roles',
        'packages',
        'admin_users',
        'api_users',
        'app_settings',
        'system_settings',
        'coverage_areas',
        'technicians',
        'network_devices',
        'subscribers',
        'subscriber_credentials',
        'subscriber_billing',
        'user_preferences',
        'connection_requests',
        'orders',
        'invoices',
        'cancellations',
        'billing_cycles',
        'payment_transactions',
        'payment_webhooks',
        'billing_events',
        'tickets',
        'ticket_details',
        'ticket_messages',
        'mikrotik_sync_log',
        'sms_messages',
        'referral_codes',
        'referrals',
        'referral_rewards',
        'turbo_boost_requests',
        'notifications',
        'audit_log',
    ];

    public const KEY_BASELINE_TABLES = [
        'packages',
        'subscribers',
        'subscriber_credentials',
        'subscriber_billing',
        'connection_requests',
        'coverage_areas',
        'orders',
        'invoices',
        'cancellations',
        'tickets',
        'billing_events',
        'audit_log',
    ];

    public static function ensureProvisioned(bool $forceReset = false): array
    {
        $baselineFile = base_path('../api/scripts/test-db-baseline.json');
        if (self::$provisionedInProcess && !$forceReset && is_file($baselineFile)) {
            $cached = json_decode((string) file_get_contents($baselineFile), true);
            if (is_array($cached)) {
                return $cached;
            }
        }

        $prodPdo = DB::connection('pgsql')->getPdo();

        // 1. Check if nextlink_test_db exists
        $stmt = $prodPdo->query("SELECT 1 FROM pg_database WHERE datname = 'nextlink_test_db'");
        $exists = (bool) $stmt->fetchColumn();

        if ($exists && !$forceReset && is_file($baselineFile)) {
            try {
                $testPdo = DB::connection('pgsql_test')->getPdo();
                $regStmt = $testPdo->query("SELECT to_regclass('public.subscribers')");
                if ($regStmt && $regStmt->fetchColumn()) {
                    self::$provisionedInProcess = true;
                    $cached = json_decode((string) file_get_contents($baselineFile), true);
                    if (is_array($cached)) {
                        return $cached;
                    }
                }
            } catch (\Throwable $e) {
                // Proceed with full provisioning below
            }
        }

        // 2. Record baseline counts from nextlink_db (read-only)
        $baselineCounts = self::getRowCounts($prodPdo, self::ORDERED_TABLES);

        if (!$exists) {
            $prodPdo->exec('CREATE DATABASE nextlink_test_db');
        }

        DB::purge('pgsql_test');
        $testPdo = DB::connection('pgsql_test')->getPdo();

        // 3. Apply schema.sql
        $schemaPath = base_path('../api/schema.sql');
        if (is_file($schemaPath)) {
            $schemaSql = (string) file_get_contents($schemaPath);
            $testPdo->exec($schemaSql);
        }

        $testPdo->exec("
            CREATE TABLE IF NOT EXISTS user_preferences (
                user_id VARCHAR(100) PRIMARY KEY,
                theme VARCHAR(30) DEFAULT 'system',
                theme_color VARCHAR(50) DEFAULT 'blue',
                font_size VARCHAR(30) DEFAULT 'medium',
                language VARCHAR(20) DEFAULT 'en',
                auto_save BOOLEAN DEFAULT TRUE,
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        ");

        if ($forceReset) {
            $reversed = array_reverse(self::ORDERED_TABLES);
            $quoted = implode(', ', array_map(fn ($t) => '"' . $t . '"', $reversed));
            $testPdo->exec("TRUNCATE TABLE {$quoted} RESTART IDENTITY CASCADE");
        }

        // 4. Clone baseline rows from nextlink_db into nextlink_test_db
        foreach (self::ORDERED_TABLES as $tbl) {
            $reg = $prodPdo->prepare('SELECT to_regclass(?)');
            $reg->execute(["public.{$tbl}"]);
            if (!$reg->fetchColumn()) {
                continue;
            }

            $rowsStmt = $prodPdo->query('SELECT * FROM "' . $tbl . '"');
            $rows = $rowsStmt ? $rowsStmt->fetchAll(PDO::FETCH_ASSOC) : [];
            if (empty($rows)) {
                continue;
            }

            $cols = array_keys($rows[0]);
            $colList = implode(', ', array_map(fn ($c) => '"' . $c . '"', $cols));
            $placeholders = implode(', ', array_fill(0, count($cols), '?'));
            $insertSql = 'INSERT INTO "' . $tbl . '" (' . $colList . ') VALUES (' . $placeholders . ') ON CONFLICT DO NOTHING';
            $insertStmt = $testPdo->prepare($insertSql);

            foreach ($rows as $row) {
                $vals = [];
                foreach ($cols as $col) {
                    $v = $row[$col];
                    if (is_bool($v)) {
                        $vals[] = $v ? 'true' : 'false';
                    } else {
                        $vals[] = $v;
                    }
                }
                $insertStmt->execute($vals);
            }
        }

        try {
            $testPdo->exec("
                SELECT setval(
                    pg_get_serial_sequence('audit_log', 'id'),
                    GREATEST(COALESCE((SELECT MAX(id) FROM audit_log), 1), 1),
                    true
                )
            ");
        } catch (\Throwable $e) {
            // ignore if audit_log sequence is empty
        }

        $testCounts = self::getRowCounts($testPdo, self::ORDERED_TABLES);
        $afterProdCounts = self::getRowCounts($prodPdo, self::ORDERED_TABLES);

        $keyBaseline = [];
        foreach (self::KEY_BASELINE_TABLES as $t) {
            $keyBaseline[$t] = [
                'nextlink_db_before' => $baselineCounts[$t] ?? 0,
                'nextlink_db_after' => $afterProdCounts[$t] ?? 0,
                'nextlink_test_db' => $testCounts[$t] ?? 0,
            ];
        }

        $allBaseline = [];
        foreach (self::ORDERED_TABLES as $t) {
            $allBaseline[$t] = [
                'nextlink_db' => $baselineCounts[$t] ?? 0,
                'nextlink_test_db' => $testCounts[$t] ?? 0,
            ];
        }

        $report = [
            'timestamp' => gmdate('c'),
            'createdNewDatabase' => !$exists,
            'keyTablesBaseline' => $keyBaseline,
            'allTablesBaseline' => $allBaseline,
        ];

        @file_put_contents($baselineFile, json_encode($report, JSON_PRETTY_PRINT));
        self::$provisionedInProcess = true;

        return $report;
    }

    private static function getRowCounts(PDO $pdo, array $tables): array
    {
        $counts = [];
        $regStmt = $pdo->prepare('SELECT to_regclass(?)');
        foreach ($tables as $tbl) {
            $regStmt->execute(["public.{$tbl}"]);
            if (!$regStmt->fetchColumn()) {
                $counts[$tbl] = null;
                continue;
            }
            $cntStmt = $pdo->query('SELECT COUNT(*)::int FROM "' . $tbl . '"');
            $counts[$tbl] = $cntStmt ? (int) $cntStmt->fetchColumn() : 0;
        }
        return $counts;
    }
}
