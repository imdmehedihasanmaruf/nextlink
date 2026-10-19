<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class InvoiceController extends Controller
{
    private function query(Request $request)
    {
        $query = DB::table('invoices')->join('subscribers', 'invoices.subscriber_id', '=', 'subscribers.id')->select('invoices.*');
        if ($request->user()->role === 'subscriber') {
            $query->where('subscribers.user_id', $request->user()->id);
        } elseif (! in_array($request->user()->role, ['super_admin', 'accounts_billing'], true)) {
            $query->whereRaw('1 = 0');
        }
        return $query;
    }

    public function index(Request $request): JsonResponse
    {
        $query = $this->query($request);
        if ($request->filled('search')) {
            $search = $request->input('search');
            $query->where(function ($q) use ($search) {
                $q->where('invoices.invoice_number', 'like', "%{$search}%")
                  ->orWhere('subscribers.name', 'like', "%{$search}%")
                  ->orWhere('subscribers.subscriber_number', 'like', "%{$search}%");
            });
        }
        if ($request->filled('status')) {
            $query->where('invoices.status', $request->input('status'));
        }
        $result = $query->orderByDesc('invoices.due_date')->paginate(min(max($request->integer('per_page', 20), 1), 100));
        // Attach subscriber info to each invoice
        $items = array_map(function ($item) {
            $subscriber = DB::table('subscribers')->find($item->subscriber_id);
            $item->subscriber_name = $subscriber?->name;
            $item->subscriber_number = $subscriber?->subscriber_number;
            return $item;
        }, $result->items());
        return response()->json(['success' => true, 'data' => $items, 'meta' => ['current_page' => $result->currentPage(), 'per_page' => $result->perPage(), 'total' => $result->total()]]);
    }

    public function generate(Request $request): JsonResponse
    {
        abort_unless(in_array($request->user()->role, ['super_admin', 'accounts_billing'], true), 403);
        $data = $request->validate(['subscriber_id' => ['required', 'integer', 'exists:subscribers,id'], 'billing_period_start' => ['required', 'date'], 'billing_period_end' => ['required', 'date', 'after_or_equal:billing_period_start'], 'due_date' => ['required', 'date']]);
        $subscriber = DB::table('subscribers')->where('id', $data['subscriber_id'])->first();
        $package = $subscriber->package_id ? DB::table('packages')->find($subscriber->package_id) : null;
        abort_if(! $package, 422, 'Subscriber has no assigned package.');
        $values = ['subscriber_id' => $subscriber->id, 'invoice_number' => 'INV-'.strtoupper(bin2hex(random_bytes(6))), 'amount' => $package->price_monthly, 'billing_period_start' => $data['billing_period_start'], 'billing_period_end' => $data['billing_period_end'], 'due_date' => $data['due_date'], 'status' => 'unpaid', 'created_at' => now(), 'updated_at' => now()];
        $inserted = DB::table('invoices')->insertOrIgnore($values);
        $invoice = DB::table('invoices')->where('subscriber_id', $subscriber->id)->where('billing_period_start', $data['billing_period_start'])->where('billing_period_end', $data['billing_period_end'])->first();
        return response()->json(['success' => true, 'message' => $inserted ? 'Invoice generated.' : 'Invoice for this period already exists.', 'data' => $invoice], $inserted ? 201 : 200);
    }

    public function show(Request $request, int $invoice): JsonResponse
    {
        abort_unless(in_array($request->user()->role, ['super_admin', 'accounts_billing', 'subscriber'], true), 403);
        $item = $this->query($request)->where('invoices.id', $invoice)->first();
        abort_if(! $item, 404);
        return response()->json(['success' => true, 'data' => $item]);
    }
}
