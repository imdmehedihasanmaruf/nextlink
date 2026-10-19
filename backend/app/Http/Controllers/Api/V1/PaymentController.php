<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class PaymentController extends Controller
{
    private function query(Request $request)
    {
        $query = DB::table('payments')->join('subscribers', 'payments.subscriber_id', '=', 'subscribers.id')->select('payments.*');
        if ($request->user()->role === 'subscriber') $query->where('subscribers.user_id', $request->user()->id);
        elseif (! in_array($request->user()->role, ['super_admin', 'accounts_billing'], true)) $query->whereRaw('1 = 0');
        return $query;
    }

    public function index(Request $request): JsonResponse
    {
        $query = $this->query($request);
        if ($request->filled('search')) {
            $search = $request->input('search');
            $query->where(function ($q) use ($search) {
                $q->where('payments.id', 'like', "%{$search}%")
                  ->orWhere('payments.transaction_reference', 'like', "%{$search}%")
                  ->orWhere('subscribers.name', 'like', "%{$search}%")
                  ->orWhere('subscribers.subscriber_number', 'like', "%{$search}%");
            });
        }
        if ($request->filled('status')) {
            $query->where('payments.status', $request->input('status'));
        }
        if ($request->filled('method')) {
            $query->where('payments.method', $request->input('method'));
        }
        $rows = $query->orderByDesc('payments.created_at')->paginate(min(max($request->integer('per_page', 20), 1), 100));
        // Attach subscriber and invoice info
        $items = array_map(function ($item) {
            $subscriber = DB::table('subscribers')->find($item->subscriber_id);
            $invoice = DB::table('invoices')->find($item->invoice_id);
            $item->subscriber_name = $subscriber?->name;
            $item->subscriber_number = $subscriber?->subscriber_number;
            $item->invoice_number = $invoice?->invoice_number;
            return $item;
        }, $rows->items());
        return response()->json(['success' => true, 'data' => $items, 'meta' => ['current_page' => $rows->currentPage(), 'per_page' => $rows->perPage(), 'total' => $rows->total()]]);
    }

    public function store(Request $request): JsonResponse
    {
        abort_unless($request->user()->role === 'subscriber', 403);
        $data = $request->validate(['invoice_id' => ['required', 'integer', 'exists:invoices,id'], 'method' => ['required', Rule::in(['bkash', 'nagad', 'rocket', 'sslcommerz', 'cash', 'manual'])], 'transaction_reference' => ['nullable', 'string', 'max:120']]);
        $invoiceQuery = DB::table('invoices')->join('subscribers', 'invoices.subscriber_id', '=', 'subscribers.id')->where('invoices.id', $data['invoice_id']);
        if ($request->user()->role === 'subscriber') $invoiceQuery->where('subscribers.user_id', $request->user()->id);
        $invoice = $invoiceQuery->select('invoices.*')->first();
        abort_if(! $invoice, 404);
        abort_if($invoice->status === 'paid', 409, 'Invoice is already paid.');
        $id = DB::table('payments')->insertGetId(['invoice_id' => $invoice->id, 'subscriber_id' => $invoice->subscriber_id, 'method' => $data['method'], 'transaction_reference' => $data['transaction_reference'] ?? null, 'amount' => $invoice->amount, 'status' => 'pending', 'created_at' => now(), 'updated_at' => now()]);
        return response()->json(['success' => true, 'message' => 'Payment recorded for verification.', 'data' => DB::table('payments')->find($id)], 201);
    }

    public function verify(Request $request, int $payment): JsonResponse
    {
        abort_unless(in_array($request->user()->role, ['super_admin', 'accounts_billing'], true), 403);
        $data = $request->validate(['status' => ['required', Rule::in(['verified', 'failed'])]]);
        $result = DB::transaction(function () use ($request, $payment, $data) {
            $record = DB::table('payments')->where('id', $payment)->lockForUpdate()->first();
            abort_if(! $record, 404);
            if ($record->status === 'verified') return $record;
            abort_unless($record->status === 'pending', 409);
            DB::table('payments')->where('id', $payment)->update(['status' => $data['status'], 'verified_at' => $data['status'] === 'verified' ? now() : null, 'verified_by' => $request->user()->id, 'updated_at' => now()]);
            if ($data['status'] === 'verified') {
                $updated = DB::table('invoices')->where('id', $record->invoice_id)->where('status', 'unpaid')->update(['status' => 'paid', 'paid_at' => now(), 'updated_at' => now()]);
                abort_unless($updated === 1, 409, 'Invoice is no longer payable.');
            }
            DB::table('audit_logs')->insert(['user_id' => $request->user()->id, 'action' => 'payment.'.$data['status'], 'record_type' => 'payment', 'record_id' => (string) $payment, 'ip_address' => $request->ip(), 'created_at' => now(), 'updated_at' => now()]);
            return DB::table('payments')->find($payment);
        });
        return response()->json(['success' => true, 'data' => $result]);
    }
}
