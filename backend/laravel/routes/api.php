<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\HealthController;
use App\Http\Controllers\SettingsController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\PackageController;
use App\Http\Controllers\CoverageController;
use App\Http\Controllers\ApplicationController;
use App\Http\Controllers\SubscriberController;
use App\Http\Controllers\SubscriptionController;
use App\Http\Controllers\OrderController;
use App\Http\Controllers\BillingController;
use App\Http\Controllers\InvoiceController;
use App\Http\Controllers\PaymentController;

/*
|--------------------------------------------------------------------------
| API Routes
|--------------------------------------------------------------------------
|
| NextLink ISP Management System — Laravel REST API Routes
|
*/

// Health check endpoints (matching Express & SRS specifications)
Route::get('/v1/health', [HealthController::class, 'check']);
Route::get('/health', [HealthController::class, 'check']);
Route::get('/api/v1/health', [HealthController::class, 'check']);
Route::get('/api/health', [HealthController::class, 'check']);

// Authentication Endpoints
Route::post('/auth/login', [AuthController::class, 'login']);
Route::post('/api/auth/login', [AuthController::class, 'login']);
Route::post('/auth/subscriber-login', [AuthController::class, 'subscriberLogin']);
Route::post('/api/auth/subscriber-login', [AuthController::class, 'subscriberLogin']);

Route::get('/auth/session-meta', [AuthController::class, 'sessionMeta']);
Route::get('/api/auth/session-meta', [AuthController::class, 'sessionMeta']);

Route::middleware('auth.jwt')->group(function () {
    Route::get('/auth/me', [AuthController::class, 'me']);
    Route::get('/api/auth/me', [AuthController::class, 'me']);
    Route::get('/auth/permissions', [AuthController::class, 'permissions']);
    Route::get('/api/auth/permissions', [AuthController::class, 'permissions']);
});

// Public Settings API (unauthenticated)
Route::get('/settings/public', [SettingsController::class, 'public']);
Route::get('/api/settings/public', [SettingsController::class, 'public']);

// Staff Settings (requires super_admin, billing, support, technician)
Route::middleware(['auth.jwt', 'role:super_admin,billing,support,technician'])->group(function () {
    Route::get('/settings', [SettingsController::class, 'index']);
    Route::get('/api/settings', [SettingsController::class, 'index']);
});

// System Settings Management (requires super_admin, billing)
Route::middleware(['auth.jwt', 'role:super_admin,billing'])->group(function () {
    Route::get('/settings/system', [SettingsController::class, 'system']);
    Route::get('/api/settings/system', [SettingsController::class, 'system']);

    Route::put('/settings/system/{group}', [SettingsController::class, 'updateGroup']);
    Route::put('/api/settings/system/{group}', [SettingsController::class, 'updateGroup']);

    Route::patch('/settings/system', [SettingsController::class, 'updateSystem']);
    Route::patch('/api/settings/system', [SettingsController::class, 'updateSystem']);

    Route::put('/settings/system', [SettingsController::class, 'updateSystem']);
    Route::put('/api/settings/system', [SettingsController::class, 'updateSystem']);
});

// =========================================================================
// Phase 4.3: Packages, Coverage, Applications, Customers & Orders
// =========================================================================

// Package APIs (Public catalog)
Route::get('/packages', [PackageController::class, 'index']);
Route::get('/api/packages', [PackageController::class, 'index']);
Route::get('/customer/packages', [PackageController::class, 'index']);
Route::get('/api/customer/packages', [PackageController::class, 'index']);
Route::get('/packages/{id}', [PackageController::class, 'show']);
Route::get('/api/packages/{id}', [PackageController::class, 'show']);

Route::middleware(['auth.jwt', 'role:super_admin,billing'])->group(function () {
    Route::post('/packages', [PackageController::class, 'store']);
    Route::post('/api/packages', [PackageController::class, 'store']);
    Route::put('/packages/{id}', [PackageController::class, 'update']);
    Route::put('/api/packages/{id}', [PackageController::class, 'update']);
    Route::patch('/packages/{id}', [PackageController::class, 'update']);
    Route::patch('/api/packages/{id}', [PackageController::class, 'update']);
    Route::delete('/packages/{id}', [PackageController::class, 'destroy']);
    Route::delete('/api/packages/{id}', [PackageController::class, 'destroy']);
});

// Coverage Area APIs (Public checker)
Route::get('/coverage/zones', [CoverageController::class, 'zones']);
Route::get('/api/coverage/zones', [CoverageController::class, 'zones']);
Route::get('/coverage/districts', [CoverageController::class, 'districts']);
Route::get('/api/coverage/districts', [CoverageController::class, 'districts']);
Route::get('/coverage/areas', [CoverageController::class, 'areas']);
Route::get('/api/coverage/areas', [CoverageController::class, 'areas']);
Route::get('/coverage/check', [CoverageController::class, 'check']);
Route::get('/api/coverage/check', [CoverageController::class, 'check']);

Route::middleware(['auth.jwt', 'role:super_admin'])->group(function () {
    Route::post('/coverage/areas', [CoverageController::class, 'store']);
    Route::post('/api/coverage/areas', [CoverageController::class, 'store']);
    Route::delete('/coverage/areas/{id}', [CoverageController::class, 'destroy']);
    Route::delete('/api/coverage/areas/{id}', [CoverageController::class, 'destroy']);
});

// Connection Request / Application APIs
Route::post('/applications', [ApplicationController::class, 'store']);
Route::post('/api/applications', [ApplicationController::class, 'store']);

Route::middleware(['auth.jwt', 'role:super_admin,billing,support'])->group(function () {
    Route::get('/applications', [ApplicationController::class, 'index']);
    Route::get('/api/applications', [ApplicationController::class, 'index']);
});

Route::middleware(['auth.jwt', 'role:super_admin,billing'])->group(function () {
    Route::patch('/applications/{id}', [ApplicationController::class, 'update']);
    Route::patch('/api/applications/{id}', [ApplicationController::class, 'update']);
});

Route::middleware(['auth.jwt', 'role:super_admin'])->group(function () {
    Route::get('/applications/{id}/document', [ApplicationController::class, 'document']);
    Route::get('/api/applications/{id}/document', [ApplicationController::class, 'document']);
});

// Customer & Portal APIs
Route::middleware('auth.jwt')->group(function () {
    Route::get('/portal/my-summary', [SubscriberController::class, 'mySummary']);
    Route::get('/api/portal/my-summary', [SubscriberController::class, 'mySummary']);

    Route::get('/customer/profile', [SubscriberController::class, 'profile']);
    Route::get('/api/customer/profile', [SubscriberController::class, 'profile']);
    Route::post('/customer/profile', [SubscriberController::class, 'updateProfile']);
    Route::post('/api/customer/profile', [SubscriberController::class, 'updateProfile']);

    Route::get('/portal/profile', [SubscriberController::class, 'profile']);
    Route::get('/api/portal/profile', [SubscriberController::class, 'profile']);
    Route::post('/portal/profile', [SubscriberController::class, 'updateProfile']);
    Route::post('/api/portal/profile', [SubscriberController::class, 'updateProfile']);

    Route::get('/portal/preferences', [SubscriberController::class, 'preferences']);
    Route::get('/api/portal/preferences', [SubscriberController::class, 'preferences']);
    Route::patch('/portal/preferences', [SubscriberController::class, 'updatePreferences']);
    Route::patch('/api/portal/preferences', [SubscriberController::class, 'updatePreferences']);
    Route::post('/portal/preferences', [SubscriberController::class, 'updatePreferences']);
    Route::post('/api/portal/preferences', [SubscriberController::class, 'updatePreferences']);
});

// Staff User / Subscriber CRUD & Listing
Route::middleware(['auth.jwt', 'role:super_admin,billing,support'])->group(function () {
    Route::get('/users', [SubscriberController::class, 'index']);
    Route::get('/api/users', [SubscriberController::class, 'index']);
    Route::post('/users', [SubscriberController::class, 'store']);
    Route::post('/api/users', [SubscriberController::class, 'store']);
    Route::put('/users', [SubscriberController::class, 'updateUser']);
    Route::put('/api/users', [SubscriberController::class, 'updateUser']);
    Route::put('/users/{id}', [SubscriberController::class, 'updateUser']);
    Route::put('/api/users/{id}', [SubscriberController::class, 'updateUser']);
    Route::delete('/users', [SubscriberController::class, 'destroyUser']);
    Route::delete('/api/users', [SubscriberController::class, 'destroyUser']);
    Route::delete('/users/{id}', [SubscriberController::class, 'destroyUser']);
    Route::delete('/api/users/{id}', [SubscriberController::class, 'destroyUser']);

    Route::get('/subscribers', [SubscriberController::class, 'index']);
    Route::get('/api/subscribers', [SubscriberController::class, 'index']);
    Route::post('/subscribers', [SubscriberController::class, 'store']);
    Route::post('/api/subscribers', [SubscriberController::class, 'store']);
    Route::put('/subscribers/{id}', [SubscriberController::class, 'updateUser']);
    Route::put('/api/subscribers/{id}', [SubscriberController::class, 'updateUser']);
});

// Orders Management (Listing for staff: super_admin, billing, support; Mutations restricted to super_admin, billing)
Route::middleware(['auth.jwt', 'role:super_admin,billing,support'])->group(function () {
    Route::get('/orders', [OrderController::class, 'index']);
    Route::get('/api/orders', [OrderController::class, 'index']);
    Route::get('/admin/orders', [OrderController::class, 'index']);
    Route::get('/api/admin/orders', [OrderController::class, 'index']);
});

Route::middleware(['auth.jwt', 'role:super_admin,billing'])->group(function () {
    Route::put('/admin/orders', [OrderController::class, 'updateStatus']);
    Route::put('/api/admin/orders', [OrderController::class, 'updateStatus']);
    Route::patch('/admin/orders/{id}', [OrderController::class, 'updateStatus']);
    Route::patch('/api/admin/orders/{id}', [OrderController::class, 'updateStatus']);
    Route::patch('/orders/{id}/status', [OrderController::class, 'updateStatus']);
    Route::patch('/api/orders/{id}/status', [OrderController::class, 'updateStatus']);
});

Route::middleware('auth.jwt')->group(function () {
    Route::get('/customer/orders', [OrderController::class, 'customerOrders']);
    Route::get('/api/customer/orders', [OrderController::class, 'customerOrders']);
    Route::post('/customer/orders/create-and-pay', [OrderController::class, 'createAndPay']);
    Route::post('/api/customer/orders/create-and-pay', [OrderController::class, 'createAndPay']);
    Route::post('/orders', [OrderController::class, 'store']);
    Route::post('/api/orders', [OrderController::class, 'store']);
});

// Subscriptions Lifecycle
Route::middleware('auth.jwt')->group(function () {
    Route::get('/customer/subscription', [SubscriptionController::class, 'show']);
    Route::get('/api/customer/subscription', [SubscriptionController::class, 'show']);
    Route::post('/customer/subscription/activate', [SubscriptionController::class, 'activate']);
    Route::post('/api/customer/subscription/activate', [SubscriptionController::class, 'activate']);
    Route::post('/customer/subscription/change-package', [SubscriptionController::class, 'changePackage']);
    Route::post('/api/customer/subscription/change-package', [SubscriptionController::class, 'changePackage']);
    Route::post('/customer/subscription/cancel', [SubscriptionController::class, 'cancel']);
    Route::post('/api/customer/subscription/cancel', [SubscriptionController::class, 'cancel']);

    Route::get('/portal/cancel-info', [SubscriptionController::class, 'cancelInfo']);
    Route::get('/api/portal/cancel-info', [SubscriptionController::class, 'cancelInfo']);
    Route::get('/portal/cancel-profile', [SubscriptionController::class, 'cancelInfo']);
    Route::get('/api/portal/cancel-profile', [SubscriptionController::class, 'cancelInfo']);
    Route::post('/portal/cancel', [SubscriptionController::class, 'cancel']);
    Route::post('/api/portal/cancel', [SubscriptionController::class, 'cancel']);
});

// Billing Quote (Public or Authenticated)
Route::match(['get', 'post'], '/billing/quote', [BillingController::class, 'quote']);
Route::match(['get', 'post'], '/api/billing/quote', [BillingController::class, 'quote']);

// Billing Management & Invoices (Staff: super_admin, billing)
Route::middleware(['auth.jwt', 'role:super_admin,billing'])->group(function () {
    Route::get('/billing/overview', [BillingController::class, 'overview']);
    Route::get('/api/billing/overview', [BillingController::class, 'overview']);

    Route::get('/billing/cycles', [BillingController::class, 'cycles']);
    Route::get('/api/billing/cycles', [BillingController::class, 'cycles']);
    Route::post('/billing/cycle/run', [BillingController::class, 'runCycle']);
    Route::post('/api/billing/cycle/run', [BillingController::class, 'runCycle']);

    Route::post('/billing/suspend-overdue', [BillingController::class, 'suspendOverdue']);
    Route::post('/api/billing/suspend-overdue', [BillingController::class, 'suspendOverdue']);

    Route::get('/billing/events', [BillingController::class, 'events']);
    Route::get('/api/billing/events', [BillingController::class, 'events']);

    Route::get('/billing/settings', [BillingController::class, 'getSettings']);
    Route::get('/api/billing/settings', [BillingController::class, 'getSettings']);
    Route::put('/billing/settings', [BillingController::class, 'updateSettings']);
    Route::put('/api/billing/settings', [BillingController::class, 'updateSettings']);

    Route::get('/billing/invoices', [InvoiceController::class, 'index']);
    Route::get('/api/billing/invoices', [InvoiceController::class, 'index']);
    Route::get('/billing/invoices/{id}', [InvoiceController::class, 'show']);
    Route::get('/api/billing/invoices/{id}', [InvoiceController::class, 'show']);
    Route::delete('/billing/invoices/{id}', [InvoiceController::class, 'destroy']);
    Route::delete('/api/billing/invoices/{id}', [InvoiceController::class, 'destroy']);
});

// Cancellations List (Staff: super_admin, billing, support)
Route::middleware(['auth.jwt', 'role:super_admin,billing,support'])->group(function () {
    Route::get('/billing/cancellations', [BillingController::class, 'cancellations']);
    Route::get('/api/billing/cancellations', [BillingController::class, 'cancellations']);
});

// PDF Invoices & Subscriber Portal Invoices
Route::middleware('auth.jwt')->group(function () {
    Route::get('/billing/invoices/{id}/pdf', [InvoiceController::class, 'pdf']);
    Route::get('/api/billing/invoices/{id}/pdf', [InvoiceController::class, 'pdf']);

    Route::get('/billing/my-invoices', [InvoiceController::class, 'myInvoices']);
    Route::get('/api/billing/my-invoices', [InvoiceController::class, 'myInvoices']);
    Route::get('/portal/my-invoices', [InvoiceController::class, 'myInvoices']);
    Route::get('/api/portal/my-invoices', [InvoiceController::class, 'myInvoices']);

    Route::get('/billing/my-summary', [InvoiceController::class, 'mySummary']);
    Route::get('/api/billing/my-summary', [InvoiceController::class, 'mySummary']);
    Route::get('/portal/my-summary', [InvoiceController::class, 'mySummary']);
    Route::get('/api/portal/my-summary', [InvoiceController::class, 'mySummary']);
});

// Payment Gateways & Public Endpoints
Route::get('/payments/gateways', [PaymentController::class, 'gateways']);
Route::get('/api/payments/gateways', [PaymentController::class, 'gateways']);

Route::post('/payments/initiate', [PaymentController::class, 'initiate']);
Route::post('/api/payments/initiate', [PaymentController::class, 'initiate']);

Route::match(['get', 'post'], '/payments/{gateway}/callback', [PaymentController::class, 'callback']);
Route::match(['get', 'post'], '/api/payments/{gateway}/callback', [PaymentController::class, 'callback']);

Route::get('/payments/mock/checkout/{transactionId}', [PaymentController::class, 'mockCheckout']);
Route::get('/api/payments/mock/checkout/{transactionId}', [PaymentController::class, 'mockCheckout']);

// Payment Transactions & Webhook Auditing (Staff: super_admin, billing)
Route::middleware(['auth.jwt', 'role:super_admin,billing'])->group(function () {
    Route::get('/payments/transactions', [PaymentController::class, 'transactions']);
    Route::get('/api/payments/transactions', [PaymentController::class, 'transactions']);

    Route::post('/payments/verify', [PaymentController::class, 'verify']);
    Route::post('/api/payments/verify', [PaymentController::class, 'verify']);

    Route::get('/payments/webhooks', [PaymentController::class, 'webhooks']);
    Route::get('/api/payments/webhooks', [PaymentController::class, 'webhooks']);

    Route::get('/payments/reconciliation', [PaymentController::class, 'reconciliation']);
    Route::get('/api/payments/reconciliation', [PaymentController::class, 'reconciliation']);
    Route::post('/payments/reconciliation/resolve', [PaymentController::class, 'resolveReconciliation']);
    Route::post('/api/payments/reconciliation/resolve', [PaymentController::class, 'resolveReconciliation']);

    Route::get('/payments/operations/stats', [PaymentController::class, 'operationsStats']);
    Route::get('/api/payments/operations/stats', [PaymentController::class, 'operationsStats']);

    Route::get('/payments/alerts', [PaymentController::class, 'alerts']);
    Route::get('/api/payments/alerts', [PaymentController::class, 'alerts']);

    Route::post('/payments/webhooks/{id}/retry', [PaymentController::class, 'retryWebhook']);
    Route::post('/api/payments/webhooks/{id}/retry', [PaymentController::class, 'retryWebhook']);

    Route::post('/payments/mock/refund', [PaymentController::class, 'mockRefund']);
    Route::post('/api/payments/mock/refund', [PaymentController::class, 'mockRefund']);
});


