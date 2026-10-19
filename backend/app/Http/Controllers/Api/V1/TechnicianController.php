<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class TechnicianController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $query = DB::table('users')
            ->whereIn('role', ['field_technician', 'support_helpdesk'])
            ->select(['id', 'name', 'email', 'role', 'avatar_path', 'created_at']);

        if ($request->filled('search')) {
            $search = $request->input('search');
            $query->where(function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                  ->orWhere('email', 'like', "%{$search}%");
            });
        }
        if ($request->filled('role')) {
            $query->where('role', $request->input('role'));
        }

        $technicians = $query->orderBy('name')->paginate(min(max($request->integer('per_page', 20), 1), 100));

        // Get ticket counts and assignment info for each technician
        $items = array_map(function ($tech) {
            $tech = (array) $tech;
            // Count open tickets assigned
            $tech['open_tickets'] = DB::table('support_tickets')
                ->where('assigned_to', $tech['id'])
                ->whereIn('status', ['open', 'in_progress'])
                ->count();
            // Count resolved this month
            $tech['resolved_this_month'] = DB::table('support_tickets')
                ->where('assigned_to', $tech['id'])
                ->where('status', 'resolved')
                ->whereMonth('updated_at', now()->month)
                ->count();
            return (object) $tech;
        }, $technicians->items());

        return response()->json(['success' => true, 'data' => $items, 'meta' => ['current_page' => $technicians->currentPage(), 'per_page' => $technicians->perPage(), 'total' => $technicians->total()]]);
    }

    public function update(Request $request, int $technician): JsonResponse
    {
        abort_unless(in_array($request->user()->role, ['super_admin', 'support_helpdesk'], true), 403);
        $tech = DB::table('users')->where('id', $technician)->whereIn('role', ['field_technician', 'support_helpdesk'])->first();
        abort_if(! $tech, 404);

        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:180'],
            'email' => ['sometimes', 'email', Rule::unique('users')->ignore($technician)],
            'role' => ['sometimes', Rule::in(['field_technician', 'support_helpdesk'])],
        ]);

        DB::table('users')->where('id', $technician)->update($data + ['updated_at' => now()]);
        return response()->json(['success' => true, 'data' => DB::table('users')->find($technician)]);
    }
}