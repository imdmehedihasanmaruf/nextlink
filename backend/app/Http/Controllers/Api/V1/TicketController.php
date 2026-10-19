<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class TicketController extends Controller
{
    private function query(Request $request)
    {
        $query = DB::table('support_tickets')->join('subscribers', 'support_tickets.subscriber_id', '=', 'subscribers.id')->select('support_tickets.*');
        if ($request->user()->role === 'subscriber') $query->where('subscribers.user_id', $request->user()->id);
        elseif ($request->user()->role === 'field_technician') $query->where('support_tickets.assigned_to', $request->user()->id);
        elseif (! in_array($request->user()->role, ['super_admin', 'support_helpdesk'], true)) $query->whereRaw('1 = 0');
        if ($request->user()->role === 'field_technician') $query->where('support_tickets.assigned_to', $request->user()->id);
        return $query;
    }

    public function index(Request $request): JsonResponse
    {
        $query = $this->query($request);
        if ($request->filled('search')) {
            $search = $request->input('search');
            $query->where(function ($q) use ($search) {
                $q->where('support_tickets.subject', 'like', "%{$search}%")
                  ->orWhere('support_tickets.description', 'like', "%{$search}%")
                  ->orWhere('subscribers.name', 'like', "%{$search}%")
                  ->orWhere('subscribers.subscriber_number', 'like', "%{$search}%");
            });
        }
        if ($request->filled('status')) {
            $query->where('support_tickets.status', $request->input('status'));
        }
        if ($request->filled('priority')) {
            $query->where('support_tickets.priority', $request->input('priority'));
        }
        $tickets = $query->orderByDesc('support_tickets.created_at')->paginate(min(max($request->integer('per_page', 20), 1), 100));
        // Attach subscriber and assigned user info
        $items = array_map(function ($item) {
            $subscriber = DB::table('subscribers')->find($item->subscriber_id);
            $assigned = $item->assigned_to ? DB::table('users')->find($item->assigned_to) : null;
            $item->subscriber_name = $subscriber?->name;
            $item->subscriber_number = $subscriber?->subscriber_number;
            $item->assigned_to_name = $assigned?->name;
            return $item;
        }, $tickets->items());
        return response()->json(['success' => true, 'data' => $items, 'meta' => ['current_page' => $tickets->currentPage(), 'per_page' => $tickets->perPage(), 'total' => $tickets->total()]]);
    }

    public function store(Request $request): JsonResponse
    {
        $role = $request->user()->role;
        abort_unless($role === 'subscriber' || in_array($role, ['super_admin', 'support_helpdesk'], true), 403);
        $data = $request->validate(['subscriber_id' => [$role === 'subscriber' ? 'prohibited' : 'sometimes', 'integer', 'exists:subscribers,id'], 'subject' => ['required', 'string', 'max:180'], 'description' => ['required', 'string', 'max:10000'], 'priority' => ['sometimes', Rule::in(['low', 'medium', 'high', 'urgent'])]]);
        $subscriberId = $role === 'subscriber' ? $request->user()->subscriber?->id : ($data['subscriber_id'] ?? null);
        abort_if(! $subscriberId, 422, 'A valid subscriber profile is required.');
        abort_unless($role !== 'subscriber' || $request->user()->subscriber?->id === $subscriberId, 403);
        $id = DB::table('support_tickets')->insertGetId(['subscriber_id' => $subscriberId, 'subject' => $data['subject'], 'description' => $data['description'], 'priority' => $data['priority'] ?? 'medium', 'status' => 'open', 'sla_due_at' => now()->addHours(24), 'created_at' => now(), 'updated_at' => now()]);
        return response()->json(['success' => true, 'data' => DB::table('support_tickets')->find($id)], 201);
    }

    public function update(Request $request, int $ticket): JsonResponse
    {
        abort_unless(in_array($request->user()->role, ['super_admin', 'support_helpdesk'], true), 403);
        abort_unless($this->query($request)->where('support_tickets.id', $ticket)->exists(), 404);
        $data = $request->validate(['assigned_to' => ['sometimes', 'nullable', 'integer', Rule::exists('users', 'id')->whereIn('role', ['support_helpdesk', 'field_technician'])], 'status' => ['sometimes', Rule::in(['open', 'in_progress', 'resolved', 'closed'])], 'priority' => ['sometimes', Rule::in(['low', 'medium', 'high', 'urgent'])]]);
        DB::table('support_tickets')->where('id', $ticket)->update($data + ['updated_at' => now()]);
        return response()->json(['success' => true, 'data' => DB::table('support_tickets')->find($ticket)]);
    }

    public function message(Request $request, int $ticket): JsonResponse
    {
        abort_unless(in_array($request->user()->role, ['super_admin', 'support_helpdesk', 'field_technician', 'subscriber'], true), 403);
        abort_unless($this->query($request)->where('support_tickets.id', $ticket)->exists(), 404);
        $data = $request->validate(['body' => ['required', 'string', 'max:10000']]);
        $id = DB::table('ticket_messages')->insertGetId(['ticket_id' => $ticket, 'user_id' => $request->user()->id, 'body' => $data['body'], 'created_at' => now(), 'updated_at' => now()]);
        return response()->json(['success' => true, 'data' => DB::table('ticket_messages')->find($id)], 201);
    }
}
