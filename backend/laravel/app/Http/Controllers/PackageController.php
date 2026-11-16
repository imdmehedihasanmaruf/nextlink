<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\Package;
use App\Models\Subscriber;
use App\Models\SubscriberBilling;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class PackageController
{
    /**
     * GET /api/packages & GET /api/customer/packages
     * Return active package catalogue ordered by price.
     */
    public function index(): JsonResponse
    {
        $packages = Package::orderBy('price', 'asc')->get();

        return response()->json([
            'success' => true,
            'packages' => $packages,
        ]);
    }

    /**
     * GET /api/packages/{id}
     * Return package details.
     */
    public function show(string $id): JsonResponse
    {
        $package = Package::find($id);

        if (!$package) {
            return response()->json([
                'success' => false,
                'error' => 'Package not found',
            ], 404);
        }

        return response()->json([
            'success' => true,
            'package' => $package,
        ]);
    }

    /**
     * POST /api/packages
     * Create package (staff only: super_admin, billing).
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'id' => 'nullable|string|max:100',
            'name' => 'required|string|max:255',
            'speed' => 'nullable|integer|min:1',
            'upload_speed' => 'nullable|integer|min:1',
            'price' => 'required|numeric|min:0',
            'duration' => 'nullable|integer|min:1',
            'description' => 'nullable|string',
            'features' => 'nullable|array',
            'popular' => 'nullable|boolean',
            'bdix_speed' => 'nullable|integer|min:0',
            'routeros_profile' => 'nullable|string|max:100',
            'max_limit' => 'nullable|string|max:50',
        ]);

        $id = $validated['id'] ?? ('PKG-' . strtoupper(bin2hex(random_bytes(3))));
        $validated['id'] = $id;
        $validated['features'] = $validated['features'] ?? [];

        $package = DB::transaction(function () use ($validated) {
            return Package::create($validated);
        });

        return response()->json([
            'success' => true,
            'package' => $package,
        ], 201);
    }

    /**
     * PUT /api/packages/{id} & PATCH /api/packages/{id}
     * Update package with strict field whitelist and subscriber billing sync (SEC-07, DB-02).
     */
    public function update(Request $request, string $id): JsonResponse
    {
        $package = Package::find($id);

        if (!$package) {
            return response()->json([
                'success' => false,
                'error' => 'Package not found',
            ], 404);
        }

        $validated = $request->validate([
            'name' => 'nullable|string|max:255',
            'speed' => 'nullable|integer|min:1',
            'upload_speed' => 'nullable|integer|min:1',
            'price' => 'nullable|numeric|min:0',
            'duration' => 'nullable|integer|min:1',
            'description' => 'nullable|string',
            'features' => 'nullable|array',
            'popular' => 'nullable|boolean',
            'bdix_speed' => 'nullable|integer|min:0',
            'routeros_profile' => 'nullable|string|max:100',
            'max_limit' => 'nullable|string|max:50',
        ]);

        $allowedFields = [
            'name',
            'speed',
            'upload_speed',
            'price',
            'duration',
            'description',
            'features',
            'popular',
            'bdix_speed',
            'routeros_profile',
            'max_limit',
        ];

        $updates = array_intersect_key($validated, array_flip($allowedFields));

        DB::transaction(function () use ($package, $updates, $id) {
            $oldName = $package->name;
            $oldPrice = (float) $package->price;

            foreach ($updates as $key => $val) {
                $package->{$key} = $val;
            }
            $package->save();

            // Sync subscriber_billing amount if price changed
            if (isset($updates['price']) && (float) $updates['price'] !== $oldPrice) {
                SubscriberBilling::where('package_id', $id)->update([
                    'amount' => (float) $updates['price'],
                ]);
            }

            // Sync subscribers raw_data packageName if name changed
            if (isset($updates['name']) && $updates['name'] !== $oldName) {
                $subscribers = Subscriber::where('package_id', $id)->get();
                foreach ($subscribers as $sub) {
                    $raw = is_array($sub->raw_data) ? $sub->raw_data : [];
                    $raw['packageName'] = $updates['name'];
                    if (isset($updates['price'])) {
                        $raw['packagePrice'] = (float) $updates['price'];
                    }
                    $sub->raw_data = $raw;
                    $sub->save();
                }
            }
        });

        return response()->json([
            'success' => true,
            'package' => $package->fresh(),
        ]);
    }

    /**
     * DELETE /api/packages/{id}
     */
    public function destroy(string $id): JsonResponse
    {
        $package = Package::find($id);

        if (!$package) {
            return response()->json([
                'success' => false,
                'error' => 'Package not found',
            ], 404);
        }

        $package->delete();

        return response()->json([
            'success' => true,
            'message' => 'Package deleted successfully',
        ]);
    }
}
