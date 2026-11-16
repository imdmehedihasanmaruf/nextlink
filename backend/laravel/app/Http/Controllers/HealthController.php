<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use App\Models\Package;

class HealthController
{
    /**
     * Check API, Database, and services readiness.
     */
    public function check(): JsonResponse
    {
        $dbConnected = false;
        $dbError = null;
        $packageCount = 0;

        try {
            DB::connection()->getPdo();
            $dbConnected = true;
            $packageCount = Package::count();
        } catch (\Throwable $e) {
            $dbError = $e->getMessage();
        }

        $status = $dbConnected ? 200 : 503;

        return response()->json([
            'success' => $dbConnected,
            'service' => 'nextlink-laravel-api',
            'version' => '13.0.0',
            'framework' => 'Laravel 13',
            'env' => config('app.env', 'production'),
            'database' => $dbConnected ? 'connected' : 'unavailable',
            'packageCount' => $packageCount,
            'mikrotikMode' => env('MIKROTIK_MODE', 'simulator'),
            'paymentMode' => env('PAYMENT_MODE', 'mock'),
            'smsMode' => env('SMS_MODE', 'mock'),
            'timestamp' => now()->toIso8601String(),
            'error' => $dbError,
        ], $status);
    }
}
