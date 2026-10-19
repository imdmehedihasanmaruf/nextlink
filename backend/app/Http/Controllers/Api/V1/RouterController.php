<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class RouterController extends Controller
{
    // In a real implementation, this would connect to actual MikroTik routers
    // using the RouterOS API. For now, we manage router records in the database.

    public function index(Request $request): JsonResponse
    {
        abort_unless(in_array($request->user()->role, ['super_admin', 'support_helpdesk'], true), 403);

        $query = DB::table('routers')->select('*');

        if ($request->filled('search')) {
            $search = $request->input('search');
            $query->where(function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                  ->orWhere('ip_address', 'like', "%{$search}%")
                  ->orWhere('location', 'like', "%{$search}%");
            });
        }
        if ($request->filled('status')) {
            $query->where('status', $request->input('status'));
        }

        $routers = $query->orderBy('name')->paginate(min(max($request->integer('per_page', 20), 1), 100));

        return response()->json(['success' => true, 'data' => $routers->items(), 'meta' => ['current_page' => $routers->currentPage(), 'per_page' => $routers->perPage(), 'total' => $routers->total()]]);
    }

    public function store(Request $request): JsonResponse
    {
        abort_unless($request->user()->role === 'super_admin', 403);

        $data = $request->validate([
            'name' => ['required', 'string', 'max:100'],
            'ip_address' => ['required', 'ip'],
            'username' => ['required', 'string', 'max:100'],
            'password' => ['required', 'string', 'max:255'],
            'api_port' => ['sometimes', 'integer', 'min:1', 'max:65535'],
            'location' => ['sometimes', 'string', 'max:200'],
            'description' => ['sometimes', 'string', 'max:500'],
        ]);

        $id = DB::table('routers')->insertGetId([
            'name' => $data['name'],
            'ip_address' => $data['ip_address'],
            'username' => $data['username'],
            'password' => $data['password'], // In production, encrypt this
            'api_port' => $data['api_port'] ?? 8728,
            'location' => $data['location'] ?? null,
            'description' => $data['description'] ?? null,
            'status' => 'offline',
            'last_sync' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return response()->json(['success' => true, 'data' => DB::table('routers')->find($id)], 201);
    }

    public function show(Request $request, int $router): JsonResponse
    {
        abort_unless(in_array($request->user()->role, ['super_admin', 'support_helpdesk'], true), 403);

        $router = DB::table('routers')->find($router);
        abort_if(! $router, 404);

        return response()->json(['success' => true, 'data' => $router]);
    }

    public function update(Request $request, int $router): JsonResponse
    {
        abort_unless($request->user()->role === 'super_admin', 403);

        $existing = DB::table('routers')->find($router);
        abort_if(! $existing, 404);

        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:100'],
            'ip_address' => ['sometimes', 'ip'],
            'username' => ['sometimes', 'string', 'max:100'],
            'password' => ['sometimes', 'string', 'max:255'],
            'api_port' => ['sometimes', 'integer', 'min:1', 'max:65535'],
            'location' => ['sometimes', 'string', 'max:200'],
            'description' => ['sometimes', 'string', 'max:500'],
            'status' => ['sometimes', Rule::in(['online', 'offline', 'error'])],
        ]);

        DB::table('routers')->where('id', $router)->update($data + ['updated_at' => now()]);
        return response()->json(['success' => true, 'data' => DB::table('routers')->find($router)]);
    }

    public function destroy(Request $request, int $router): JsonResponse
    {
        abort_unless($request->user()->role === 'super_admin', 403);

        $deleted = DB::table('routers')->where('id', $router)->delete();
        abort_if(! $deleted, 404);

        return response()->json(['success' => true, 'message' => 'Router removed.']);
    }

    public function sync(Request $request, int $router): JsonResponse
    {
        abort_unless(in_array($request->user()->role, ['super_admin', 'support_helpdesk'], true), 403);

        $router = DB::table('routers')->find($router);
        abort_if(! $router, 404);

        // In a real implementation, this would:
        // 1. Connect to the MikroTik via RouterOS API
        // 2. Fetch current status, resources, interfaces
        // 3. Update the local cache

        // For demo purposes, we simulate a sync
        DB::table('routers')->where('id', $router)->update([
            'status' => 'online',
            'last_sync' => now(),
            'updated_at' => now(),
        ]);

        return response()->json(['success' => true, 'message' => 'Router synchronized.', 'data' => DB::table('routers')->find($router)]);
    }
}