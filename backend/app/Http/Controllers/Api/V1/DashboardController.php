<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Http\Request;

class DashboardController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $this->authorize('viewAny', \App\Models\Subscriber::class);
        $role = request()->user()->role;
        $period = $request->validate(['period' => ['sometimes', 'in:month,quarter,year'], 'status' => ['sometimes', 'in:all,active,suspended,pending']]);
        $subscribers = DB::table('subscribers');
        if (($period['status'] ?? 'all') !== 'all') $subscribers->where('status', $period['status']);
        $data = [
            'total_subscribers' => (clone $subscribers)->count(),
            'active_connections' => (clone $subscribers)->where('status', 'active')->count(),
            'suspended_connections' => (clone $subscribers)->where('status', 'suspended')->count(),
            'pending_connections' => (clone $subscribers)->where('status', 'pending')->count(),
            'open_tickets' => DB::table('support_tickets')->whereIn('status', ['open', 'in_progress'])->count(),
        ];
        if (in_array($role, ['super_admin', 'accounts_billing'], true)) {
            $data['unpaid_invoice_total'] = (float) DB::table('invoices')->where('status', 'unpaid')->sum('amount');
            $start = match ($period['period'] ?? 'month') { 'quarter' => now()->startOfQuarter(), 'year' => now()->startOfYear(), default => now()->startOfMonth() };
            $data['payments_received_this_month'] = (float) DB::table('payments')->where('status', 'verified')->whereBetween('verified_at', [$start, now()])->sum('amount');
            $data['monthly_recurring_revenue'] = (float) DB::table('subscribers')->join('packages', 'subscribers.package_id', '=', 'packages.id')->where('subscribers.status', 'active')->sum('packages.price_monthly');
        }
        if ($role === 'subscriber') {
            $subscriberId = $request->user()->subscriber?->id;
            $data['total_subscribers'] = $subscriberId ? 1 : 0;
            $data['active_connections'] = $subscriberId ? DB::table('subscribers')->where('id', $subscriberId)->where('status', 'active')->count() : 0;
            $data['suspended_connections'] = $subscriberId ? DB::table('subscribers')->where('id', $subscriberId)->where('status', 'suspended')->count() : 0;
            $data['pending_connections'] = $subscriberId ? DB::table('subscribers')->where('id', $subscriberId)->where('status', 'pending')->count() : 0;
            $data['open_tickets'] = $subscriberId ? DB::table('support_tickets')->where('subscriber_id', $subscriberId)->whereIn('status', ['open', 'in_progress'])->count() : 0;
        }
        return response()->json(['success' => true, 'data' => $data]);
    }
}
