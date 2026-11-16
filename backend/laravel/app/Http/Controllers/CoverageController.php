<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\CoverageArea;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class CoverageController
{
    /**
     * GET /api/coverage/zones
     * Return list of zones with coverage counts.
     */
    public function zones(): JsonResponse
    {
        $zones = DB::table('coverage_areas')
            ->selectRaw("zone, COUNT(*)::int as area_count, COUNT(*) FILTER (WHERE status = 'available')::int as available_count")
            ->groupBy('zone')
            ->orderBy('zone')
            ->get();

        return response()->json([
            'success' => true,
            'zones' => $zones,
        ]);
    }

    /**
     * GET /api/coverage/districts
     * Return districts within a zone.
     */
    public function districts(Request $request): JsonResponse
    {
        $zone = trim((string) $request->query('zone', ''));
        if (empty($zone)) {
            return response()->json([
                'success' => false,
                'error' => 'zone is required',
            ], 400);
        }

        $districts = DB::table('coverage_areas')
            ->selectRaw("district, COUNT(*)::int as area_count, COUNT(*) FILTER (WHERE status = 'available')::int as available_count")
            ->whereRaw('LOWER(zone) = LOWER(?)', [$zone])
            ->groupBy('district')
            ->orderBy('district')
            ->get();

        return response()->json([
            'success' => true,
            'zone' => $zone,
            'districts' => $districts,
        ]);
    }

    /**
     * GET /api/coverage/areas
     * Return all coverage areas (with map coordinates).
     */
    public function areas(Request $request): JsonResponse
    {
        $query = CoverageArea::query();

        if ($request->has('zone') && !empty($request->query('zone'))) {
            $query->whereRaw('LOWER(zone) = LOWER(?)', [trim((string) $request->query('zone'))]);
        }

        if ($request->has('district') && !empty($request->query('district'))) {
            $query->whereRaw('LOWER(district) = LOWER(?)', [trim((string) $request->query('district'))]);
        }

        $areas = $query->orderBy('zone')->orderBy('district')->get();

        return response()->json([
            'success' => true,
            'areas' => $areas,
        ]);
    }

    /**
     * GET /api/coverage/check
     * Check whether a specific location (zone, district, area) is covered.
     */
    public function check(Request $request): JsonResponse
    {
        $zone = trim((string) $request->query('zone', ''));
        $district = trim((string) $request->query('district', ''));
        $area = trim((string) $request->query('area', ''));

        if (empty($zone)) {
            return response()->json([
                'success' => false,
                'error' => 'zone is required',
            ], 400);
        }

        $query = CoverageArea::whereRaw('LOWER(zone) = LOWER(?)', [$zone]);

        if (!empty($district)) {
            $query->whereRaw('LOWER(district) = LOWER(?)', [$district]);
        }

        $rows = $query->get();

        if ($rows->isEmpty()) {
            return response()->json([
                'success' => true,
                'covered' => false,
                'reason' => 'zone_not_covered',
                'zone' => $zone,
                'district' => !empty($district) ? $district : null,
            ]);
        }

        $matchedRow = null;
        if (!empty($area)) {
            foreach ($rows as $candidate) {
                $candidateAreas = is_array($candidate->areas) ? $candidate->areas : [];
                foreach ($candidateAreas as $item) {
                    if (stripos((string) $item, $area) !== false) {
                        $matchedRow = $candidate;
                        break 2;
                    }
                }
            }

            if (!$matchedRow) {
                $firstRow = $rows->first();
                return response()->json([
                    'success' => true,
                    'covered' => false,
                    'reason' => 'district_known_area_unknown',
                    'zone' => $zone,
                    'district' => $firstRow->district,
                    'availableAreas' => is_array($firstRow->areas) ? $firstRow->areas : [],
                ]);
            }
        } else {
            $matchedRow = $rows->first();
        }

        $isAvailable = ($matchedRow->status === 'available');

        return response()->json([
            'success' => true,
            'covered' => $isAvailable,
            'reason' => $isAvailable ? 'available' : ($matchedRow->status ?? 'unavailable'),
            'zone' => $matchedRow->zone,
            'district' => $matchedRow->district,
            'areas' => is_array($matchedRow->areas) ? $matchedRow->areas : [],
            'lat' => $matchedRow->lat !== null ? (float) $matchedRow->lat : null,
            'lng' => $matchedRow->lng !== null ? (float) $matchedRow->lng : null,
            'notes' => $matchedRow->notes,
        ]);
    }

    /**
     * POST /api/coverage/areas
     * Upsert coverage area (super_admin) with deterministic ID and audit log.
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'id' => 'nullable|string|max:64',
            'zone' => 'required|string|max:120',
            'district' => 'nullable|string|max:120',
            'areas' => 'nullable|array',
            'status' => 'nullable|string|in:available,unavailable,planned',
            'lat' => 'nullable|numeric',
            'lng' => 'nullable|numeric',
            'notes' => 'nullable|string',
        ]);

        $areasList = $validated['areas'] ?? [];
        $hashSource = strtolower(($validated['zone'] ?? '') . '::' . ($validated['district'] ?? '') . '::' . implode(',', $areasList));
        $id = !empty($validated['id']) ? $validated['id'] : ('COV-' . substr(sha1($hashSource), 0, 16));

        $validated['id'] = $id;
        $validated['status'] = $validated['status'] ?? 'available';
        $validated['areas'] = $areasList;

        $user = $request->attributes->get('user') ?? $request->user();
        $actorId = is_object($user) ? ($user->id ?? 'staff') : ($user['id'] ?? 'staff');
        $actorRole = is_object($user) ? ($user->role ?? 'super_admin') : ($user['role'] ?? 'super_admin');

        $area = DB::transaction(function () use ($id, $validated, $actorId, $actorRole, $request) {
            $saved = CoverageArea::updateOrCreate(
                ['id' => $id],
                $validated
            );

            AuditLog::create([
                'actor_id' => $actorId,
                'actor_role' => $actorRole,
                'action' => 'coverage.area_saved',
                'entity_type' => 'coverage_area',
                'entity_id' => $id,
                'details' => [
                    'zone' => $validated['zone'],
                    'district' => $validated['district'] ?? null,
                    'status' => $validated['status'],
                ],
                'ip_address' => $request->ip(),
                'created_at' => now(),
            ]);

            return $saved;
        });

        return response()->json([
            'success' => true,
            'area' => $area,
        ]);
    }

    /**
     * DELETE /api/coverage/areas/{id}
     */
    public function destroy(Request $request, string $id): JsonResponse
    {
        $area = CoverageArea::find($id);

        if (!$area) {
            return response()->json([
                'success' => false,
                'error' => 'Coverage area not found',
            ], 404);
        }

        $user = $request->attributes->get('user') ?? $request->user();
        $actorId = is_object($user) ? ($user->id ?? 'staff') : ($user['id'] ?? 'staff');
        $actorRole = is_object($user) ? ($user->role ?? 'super_admin') : ($user['role'] ?? 'super_admin');

        DB::transaction(function () use ($area, $id, $actorId, $actorRole, $request) {
            $area->delete();

            AuditLog::create([
                'actor_id' => $actorId,
                'actor_role' => $actorRole,
                'action' => 'coverage.area_deleted',
                'entity_type' => 'coverage_area',
                'entity_id' => $id,
                'details' => ['id' => $id],
                'ip_address' => $request->ip(),
                'created_at' => now(),
            ]);
        });

        return response()->json([
            'success' => true,
            'message' => 'Coverage area deleted',
        ]);
    }
}
