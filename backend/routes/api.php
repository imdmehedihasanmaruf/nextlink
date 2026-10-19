<?php

use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\DashboardController;
use App\Http\Controllers\Api\V1\InvoiceController;
use App\Http\Controllers\Api\V1\PackageController;
use App\Http\Controllers\Api\V1\PublicController;
use App\Http\Controllers\Api\V1\ReportController;
use App\Http\Controllers\Api\V1\PaymentController;
use App\Http\Controllers\Api\V1\SubscriberController;
use App\Http\Controllers\Api\V1\SettingsController;
use App\Http\Controllers\Api\V1\TicketController;
use App\Http\Controllers\Api\V1\TechnicianController;
use App\Http\Controllers\Api\V1\RouterController;
use App\Http\Controllers\Api\V1\StaffController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function () {
    Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:login');
    Route::get('/packages', [PackageController::class, 'index']);
    Route::get('/packages/{package}', [PackageController::class, 'show']);
    Route::post('/coverage/check', [PublicController::class, 'coverage'])->middleware('throttle:30,1');
    Route::post('/applications', [PublicController::class, 'apply'])->middleware('throttle:5,1');

    Route::middleware('auth:sanctum')->group(function () {
        Route::post('/auth/logout', [AuthController::class, 'logout']);
        Route::get('/auth/me', [AuthController::class, 'me']);
        Route::post('/auth/profile', [AuthController::class, 'updateProfile']);
        Route::put('/auth/password', [AuthController::class, 'updatePassword']);
        Route::get('/dashboard', DashboardController::class);
        Route::get('/reports/overview', ReportController::class);
        Route::get('/settings', [SettingsController::class, 'index']);
        Route::put('/settings', [SettingsController::class, 'update']);
        Route::get('/subscribers', [SubscriberController::class, 'index']);
        Route::post('/subscribers', [SubscriberController::class, 'store']);
        Route::get('/subscribers/{subscriber}', [SubscriberController::class, 'show']);
        Route::put('/subscribers/{subscriber}', [SubscriberController::class, 'update']);
        Route::delete('/subscribers/{subscriber}', [SubscriberController::class, 'destroy']);
        Route::post('/packages', [PackageController::class, 'store']);
        Route::put('/packages/{package}', [PackageController::class, 'update']);
        Route::get('/invoices', [InvoiceController::class, 'index']);
        Route::post('/invoices/generate', [InvoiceController::class, 'generate']);
        Route::get('/invoices/{invoice}', [InvoiceController::class, 'show']);
        Route::get('/payments', [PaymentController::class, 'index']);
        Route::post('/payments', [PaymentController::class, 'store']);
        Route::post('/payments/{payment}/verify', [PaymentController::class, 'verify']);
        Route::get('/tickets', [TicketController::class, 'index']);
        Route::post('/tickets', [TicketController::class, 'store']);
        Route::patch('/tickets/{ticket}', [TicketController::class, 'update']);
        Route::post('/tickets/{ticket}/messages', [TicketController::class, 'message']);
        Route::get('/technicians', [TechnicianController::class, 'index']);
        Route::put('/technicians/{technician}', [TechnicianController::class, 'update']);
        Route::get('/routers', [RouterController::class, 'index']);
        Route::post('/routers', [RouterController::class, 'store']);
        Route::get('/routers/{router}', [RouterController::class, 'show']);
        Route::put('/routers/{router}', [RouterController::class, 'update']);
        Route::delete('/routers/{router}', [RouterController::class, 'destroy']);
        Route::post('/routers/{router}/sync', [RouterController::class, 'sync']);
        Route::get('/staff', [StaffController::class, 'index']);
        Route::post('/staff', [StaffController::class, 'store']);
        Route::put('/staff/{user}', [StaffController::class, 'update']);
        Route::delete('/staff/{user}', [StaffController::class, 'destroy']);
    });
});
