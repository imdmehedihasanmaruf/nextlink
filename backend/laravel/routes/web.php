<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\HealthController;

Route::get('/', function () {
    return response()->json(['service' => 'nextlink-laravel-api', 'status' => 'ok']);
});

Route::get('/health', [HealthController::class, 'check']);
Route::get('/api/v1/health', [HealthController::class, 'check']);
Route::get('/api/health', [HealthController::class, 'check']);
