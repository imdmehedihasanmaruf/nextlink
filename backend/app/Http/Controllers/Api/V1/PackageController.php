<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class PackageController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        abort_if($request->user() && ! in_array($request->user()->role, ['super_admin', 'accounts_billing', 'support_helpdesk', 'field_technician', 'subscriber'], true), 403);
        $query = DB::table('packages');
        if ($search = $request->string('search')->trim()->toString()) {
            $query->where(fn ($builder) => $builder->where('name', 'like', "%{$search}%")->orWhere('description', 'like', "%{$search}%"));
        }
        if ($request->user()?->role === 'super_admin' && $request->query->has('is_active')) {
            $query->where('is_active', $request->boolean('is_active'));
        }
        if (! $request->user() || $request->user()->role === 'subscriber') {
            $query->where('is_active', true);
        }
        $packages = $query->select('packages.*')->selectSub(fn ($sub) => $sub->from('subscribers')->selectRaw('count(*)')->whereColumn('subscribers.package_id', 'packages.id'), 'subscriber_count')->orderBy('price_monthly')->paginate(min(max($request->integer('per_page', 20), 1), 100));
        $items = collect($packages->items())->map(function ($item) {
            $item->features = is_array($item->features) ? $item->features : (json_decode($item->features, true) ?: []);
            return $item;
        });
        return response()->json(['success' => true, 'message' => 'Packages retrieved successfully.', 'data' => $items, 'meta' => ['current_page' => $packages->currentPage(), 'per_page' => $packages->perPage(), 'total' => $packages->total(), 'last_page' => $packages->lastPage()]]);
    }

    public function show(int $package): JsonResponse
    {
        $item = DB::table('packages')->where('id', $package)->first();
        abort_if(! $item || (! $item->is_active && (! request()->user() || request()->user()->role === 'subscriber')), 404);
        return response()->json(['success' => true, 'data' => $item]);
    }

    public function store(Request $request): JsonResponse
    {
        abort_unless($request->user(), 401);
        abort_unless($request->user()->role === 'super_admin', 403);
        $data = $request->validate(['name' => ['required', 'string', 'max:120', 'unique:packages,name'], 'description' => ['nullable', 'string'], 'download_mbps' => ['required', 'integer', 'min:1'], 'upload_mbps' => ['required', 'integer', 'min:1'], 'price_monthly' => ['required', 'numeric', 'min:0'], 'installation_fee' => ['sometimes', 'numeric', 'min:0'], 'bdix_mbps' => ['nullable', 'integer', 'min:0'], 'features' => ['sometimes', 'array', 'max:20'], 'features.*' => ['string', 'max:120'], 'is_active' => ['sometimes', 'boolean']]);
        $id = DB::table('packages')->insertGetId(collect($data)->except('features')->all() + ['features' => json_encode($data['features'] ?? []), 'is_active' => $data['is_active'] ?? true, 'installation_fee' => $data['installation_fee'] ?? 0, 'created_at' => now(), 'updated_at' => now()]);
        $package = DB::table('packages')->find($id);
        $package->features = json_decode($package->features, true) ?: [];
        return response()->json(['success' => true, 'message' => 'Package created successfully.', 'data' => $package], 201);
    }

    public function update(Request $request, int $package): JsonResponse
    {
        abort_unless($request->user(), 401);
        abort_unless($request->user()->role === 'super_admin', 403);
        abort_unless(DB::table('packages')->where('id', $package)->exists(), 404);
        $data = $request->validate(['name' => ['sometimes', 'string', 'max:120', Rule::unique('packages', 'name')->ignore($package)], 'description' => ['sometimes', 'nullable', 'string'], 'download_mbps' => ['sometimes', 'integer', 'min:1'], 'upload_mbps' => ['sometimes', 'integer', 'min:1'], 'price_monthly' => ['sometimes', 'numeric', 'min:0'], 'installation_fee' => ['sometimes', 'numeric', 'min:0'], 'bdix_mbps' => ['sometimes', 'nullable', 'integer', 'min:0'], 'features' => ['sometimes', 'array', 'max:20'], 'features.*' => ['string', 'max:120'], 'is_active' => ['sometimes', 'boolean']]);
        if (isset($data['features'])) $data['features'] = json_encode($data['features']);
        DB::table('packages')->where('id', $package)->update($data + ['updated_at' => now()]);
        $item = DB::table('packages')->find($package);
        $item->features = json_decode($item->features, true) ?: [];
        return response()->json(['success' => true, 'message' => 'Package updated successfully.', 'data' => $item]);
    }
}
