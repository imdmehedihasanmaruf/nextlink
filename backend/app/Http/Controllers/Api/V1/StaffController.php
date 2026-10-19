<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class StaffController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        abort_unless($request->user()->role === 'super_admin', 403);

        $query = DB::table('users')->select(['id', 'name', 'email', 'role', 'avatar_path', 'created_at']);

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

        $users = $query->orderBy('name')->paginate(min(max($request->integer('per_page', 20), 1), 100));

        return response()->json(['success' => true, 'data' => $users->items(), 'meta' => ['current_page' => $users->currentPage(), 'per_page' => $users->perPage(), 'total' => $users->total()]]);
    }

    public function store(Request $request): JsonResponse
    {
        abort_unless($request->user()->role === 'super_admin', 403);

        $data = $request->validate([
            'name' => ['required', 'string', 'max:180'],
            'email' => ['required', 'email', Rule::unique('users')],
            'role' => ['required', Rule::in(['super_admin', 'accounts_billing', 'support_helpdesk', 'field_technician'])],
        ]);

        // In production, generate random password and send email
        $id = DB::table('users')->insertGetId([
            'name' => $data['name'],
            'email' => $data['email'],
            'role' => $data['role'],
            'password' => bcrypt('password123'), // Demo default
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return response()->json(['success' => true, 'data' => DB::table('users')->find($id)], 201);
    }

    public function update(Request $request, int $user): JsonResponse
    {
        abort_unless($request->user()->role === 'super_admin', 403);

        $existing = DB::table('users')->find($user);
        abort_if(! $existing, 404);

        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:180'],
            'email' => ['sometimes', 'email', Rule::unique('users')->ignore($user)],
            'role' => ['sometimes', Rule::in(['super_admin', 'accounts_billing', 'support_helpdesk', 'field_technician'])],
        ]);

        DB::table('users')->where('id', $user)->update($data + ['updated_at' => now()]);
        return response()->json(['success' => true, 'data' => DB::table('users')->find($user)]);
    }

    public function destroy(Request $request, int $user): JsonResponse
    {
        abort_unless($request->user()->role === 'super_admin', 403);
        abort_if($user === $request->user()->id, 422, 'Cannot delete your own account.');

        $deleted = DB::table('users')->where('id', $user)->delete();
        abort_if(! $deleted, 404);

        return response()->json(['success' => true, 'message' => 'Staff member removed.']);
    }
}