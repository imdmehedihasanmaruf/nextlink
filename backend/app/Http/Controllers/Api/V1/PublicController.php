<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class PublicController extends Controller
{
    public function coverage(Request $request): JsonResponse
    {
        $data = $request->validate(['district' => ['required', 'string', 'max:100'], 'area' => ['required', 'string', 'max:100']]);
        $available = DB::table('coverage_zones')->where('district', $data['district'])->where('area', $data['area'])->where('is_active', true)->exists();
        return response()->json(['success' => true, 'data' => ['available' => $available, 'configured' => DB::table('coverage_zones')->exists()]]);
    }

    public function apply(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'], 'email' => ['required', 'email', 'max:255'],
            'phone' => ['required', 'string', 'max:32'], 'address' => ['required', 'string', 'max:2000'],
            'district' => ['required', 'string', 'max:100'], 'area' => ['required', 'string', 'max:100'],
            'package_id' => ['nullable', 'integer', Rule::exists('packages', 'id')->where('is_active', true)],
            'nid_document' => ['nullable', 'file', 'mimes:pdf,jpg,jpeg,png', 'max:5120'],
        ]);
        $path = isset($data['nid_document']) ? $data['nid_document']->store('private/application-documents') : null;
        $id = DB::table('connection_applications')->insertGetId([
            ...collect($data)->except('nid_document')->all(), 'package_id' => $data['package_id'] ?? null,
            'document_path' => $path, 'status' => 'pending', 'ip_address' => $request->ip(), 'created_at' => now(), 'updated_at' => now(),
        ]);
        return response()->json(['success' => true, 'message' => 'Application submitted for review.', 'data' => ['id' => $id, 'status' => 'pending']], 201);
    }
}
