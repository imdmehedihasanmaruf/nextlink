<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class ReportController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        abort_unless(in_array($request->user()->role, ['super_admin', 'accounts_billing'], true), 403);
        $filters = $request->validate(['from' => ['nullable', 'date'], 'to' => ['nullable', 'date', 'after_or_equal:from']]);
        $payments = DB::table('payments')->where('status', 'verified');
        if (isset($filters['from'])) $payments->whereDate('verified_at', '>=', $filters['from']);
        if (isset($filters['to'])) $payments->whereDate('verified_at', '<=', $filters['to']);
        $byStatus = DB::table('subscribers')->select('status', DB::raw('count(*) as total'))->groupBy('status')->get();
        $packages = DB::table('subscribers')->join('packages', 'subscribers.package_id', '=', 'packages.id')->select('packages.name', DB::raw('count(*) as subscribers'))->groupBy('packages.id', 'packages.name')->get();
        $months = collect(range(5, 0))->map(function (int $offset) {
            $month = now()->startOfMonth()->subMonths($offset);
            return ['label' => $month->format('M'), 'collected' => (float) DB::table('payments')->where('status', 'verified')->whereBetween('verified_at', [$month->copy()->startOfMonth(), $month->copy()->endOfMonth()])->sum('amount'), 'invoiced' => (float) DB::table('invoices')->whereBetween('created_at', [$month->copy()->startOfMonth(), $month->copy()->endOfMonth()])->sum('amount')];
        });
        $recentInvoices = DB::table('invoices')->join('subscribers', 'invoices.subscriber_id', '=', 'subscribers.id')->leftJoin('users', 'subscribers.user_id', '=', 'users.id')->select('invoices.id', 'invoices.invoice_number', 'invoices.amount', 'invoices.status', 'invoices.due_date', 'users.name as subscriber_name')->orderByDesc('invoices.created_at')->limit(6)->get();
        $recentTickets = DB::table('support_tickets')->join('subscribers', 'support_tickets.subscriber_id', '=', 'subscribers.id')->leftJoin('users', 'subscribers.user_id', '=', 'users.id')->select('support_tickets.id', 'support_tickets.subject', 'support_tickets.status', 'support_tickets.priority', 'support_tickets.created_at', 'users.name as subscriber_name')->orderByDesc('support_tickets.created_at')->limit(6)->get();
        $roleCounts = DB::table('users')->select('role', DB::raw('count(*) as total'))->groupBy('role')->get();
        $recentSubscribers = DB::table('subscribers')->leftJoin('users', 'subscribers.user_id', '=', 'users.id')->select('subscribers.id', 'subscribers.subscriber_number', 'subscribers.status', 'subscribers.created_at', 'users.name')->orderByDesc('subscribers.created_at')->limit(6)->get();
        $todayPaid = (float) DB::table('payments')->where('status', 'verified')->whereDate('verified_at', today())->sum('amount');
        $currentMonthPaid = (float) DB::table('payments')->where('status', 'verified')->whereBetween('verified_at', [now()->startOfMonth(), now()->endOfMonth()])->sum('amount');
        $previousMonthPaid = (float) DB::table('payments')->where('status', 'verified')->whereBetween('verified_at', [now()->subMonth()->startOfMonth(), now()->subMonth()->endOfMonth()])->sum('amount');
        $invoicesDueSoon = DB::table('invoices')->where('status', 'unpaid')->whereBetween('due_date', [today(), today()->addDays(7)])->count();
        $ticketsByPriority = DB::table('support_tickets')->whereIn('status', ['open', 'in_progress'])->select('priority', DB::raw('count(*) as total'))->groupBy('priority')->get();
        $ticketResolution = DB::table('support_tickets')->select('status', DB::raw('count(*) as total'))->groupBy('status')->get();
        $newSubscribersThisMonth = DB::table('subscribers')->whereBetween('created_at', [now()->startOfMonth(), now()])->count();
        $newSubscribersPreviousMonth = DB::table('subscribers')->whereBetween('created_at', [now()->subMonth()->startOfMonth(), now()->subMonth()->endOfMonth()])->count();
        $totalInvoiced = (float) DB::table('invoices')->sum('amount');
        $collectionRate = $totalInvoiced > 0 ? round(((float) DB::table('invoices')->where('status', 'paid')->sum('amount') / $totalInvoiced) * 100, 1) : 0;
        $applications = Schema::hasTable('connection_applications') ? DB::table('connection_applications')->select('status', DB::raw('count(*) as total'))->groupBy('status')->get() : collect();
        $pendingApplications = Schema::hasTable('connection_applications') ? DB::table('connection_applications')->whereIn('status', ['pending', 'submitted'])->count() : 0;
        $topPackages = DB::table('subscribers')->join('packages', 'subscribers.package_id', '=', 'packages.id')->select('packages.name', DB::raw('count(*) as subscribers'))->groupBy('packages.id', 'packages.name')->orderByDesc('subscribers')->limit(5)->get();
        $failedPayments = DB::table('payments')->where('status', 'failed')->count();
        $ticketsResolvedThisMonth = DB::table('support_tickets')->whereIn('status', ['resolved', 'closed'])->whereBetween('updated_at', [now()->startOfMonth(), now()])->count();
        return response()->json(['success' => true, 'data' => ['collected_total' => (float) $payments->sum('amount'), 'subscriber_status' => $byStatus, 'package_distribution' => $packages, 'unpaid_balance' => (float) DB::table('invoices')->where('status', 'unpaid')->sum('amount'), 'monthly_series' => $months, 'recent_invoices' => $recentInvoices, 'recent_tickets' => $recentTickets, 'role_counts' => $roleCounts, 'recent_subscribers' => $recentSubscribers, 'pending_payments' => DB::table('payments')->where('status', 'pending')->count(), 'overdue_invoices' => DB::table('invoices')->where('status', 'unpaid')->whereDate('due_date', '<', today())->count(), 'active_packages' => DB::table('packages')->where('is_active', true)->count(), 'payment_methods' => DB::table('payments')->where('status', 'verified')->select('method', DB::raw('count(*) as total'))->groupBy('method')->get(), 'today_collected' => $todayPaid, 'month_collected' => $currentMonthPaid, 'previous_month_collected' => $previousMonthPaid, 'invoices_due_soon' => $invoicesDueSoon, 'tickets_by_priority' => $ticketsByPriority, 'ticket_resolution' => $ticketResolution, 'new_subscribers_this_month' => $newSubscribersThisMonth, 'new_subscribers_previous_month' => $newSubscribersPreviousMonth, 'collection_rate' => $collectionRate, 'pending_applications' => $pendingApplications, 'application_status' => $applications, 'top_packages' => $topPackages, 'failed_payments' => $failedPayments, 'tickets_resolved_this_month' => $ticketsResolvedThisMonth]]);
    }
}
