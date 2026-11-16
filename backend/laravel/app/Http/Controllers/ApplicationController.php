<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\ConnectionRequest;
use App\Models\Notification;
use App\Models\Package;
use App\Models\Subscriber;
use App\Models\SubscriberBilling;
use App\Models\SubscriberCredential;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Symfony\Component\HttpFoundation\Response;

class ApplicationController
{
    /**
     * Validate binary magic bytes against declared MIME type (SEC-09).
     */
    protected function hasValidMagicBytes(string $binary, string $mime): bool
    {
        if (strlen($binary) < 4) {
            return false;
        }

        return match ($mime) {
            'image/png' => str_starts_with($binary, "\x89PNG\r\n\x1a\n"),
            'image/jpeg' => str_starts_with($binary, "\xFF\xD8\xFF"),
            'application/pdf' => str_starts_with($binary, "%PDF-"),
            'image/webp' => strlen($binary) >= 12
                && substr($binary, 0, 4) === 'RIFF'
                && substr($binary, 8, 4) === 'WEBP',
            default => false,
        };
    }

    /**
     * POST /api/applications
     * Submit online connection request (public) with strict NID validation (SEC-09, DB-04).
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'fullName' => 'required|string|min:3|max:255',
            'phone' => 'required|string|min:7|max:60',
            'email' => 'nullable|email|max:255',
            'idNumber' => 'required|string|min:6|max:120',
            'idDocumentDataUrl' => 'nullable|string',
            'address' => 'required|string|min:5|max:1000',
            'packageId' => 'nullable|string|max:100',
            'packageName' => 'nullable|string|max:255',
            'ontConfig' => 'nullable|string|max:120',
            'referral' => 'nullable|string|max:120',
        ]);

        $year = date('Y');
        $random = strtoupper(substr(bin2hex(random_bytes(4)), 0, 8));
        $id = "APP-{$year}-{$random}";

        $documentPath = null;
        $rawDataUrl = isset($validated['idDocumentDataUrl']) ? trim((string) $validated['idDocumentDataUrl']) : '';

        if ($rawDataUrl !== '') {
            if (!preg_match('/^data:([^;]+);base64,(.+)$/s', $rawDataUrl, $matches)) {
                return response()->json([
                    'success' => false,
                    'error' => 'Invalid ID document format or size. Expected base64 data URL.',
                ], 400);
            }

            $mime = strtolower(trim($matches[1]));
            $base64Data = preg_replace('/\s+/', '', $matches[2]);
            $allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

            if (!in_array($mime, $allowedMimes, true)) {
                return response()->json([
                    'success' => false,
                    'error' => 'Unsupported ID document MIME type. Allowed: JPEG, PNG, WEBP, PDF.',
                ], 400);
            }

            $decoded = base64_decode($base64Data, true);
            if ($decoded === false || strlen($decoded) === 0 || strlen($decoded) > 10 * 1024 * 1024) {
                return response()->json([
                    'success' => false,
                    'error' => 'Invalid ID document payload or file exceeds 10MB limit.',
                ], 400);
            }

            if (!$this->hasValidMagicBytes($decoded, $mime)) {
                return response()->json([
                    'success' => false,
                    'error' => 'ID document binary signature does not match declared file type.',
                ], 400);
            }

            $extension = match ($mime) {
                'image/jpeg' => 'jpg',
                'image/png' => 'png',
                'image/webp' => 'webp',
                'application/pdf' => 'pdf',
            };

            $safeId = preg_replace('/[^a-zA-Z0-9_-]/', '_', $id);
            $safeFilename = "nid_{$safeId}.{$extension}";
            $storageDir = storage_path('app/applications');
            if (!is_dir($storageDir)) {
                @mkdir($storageDir, 0755, true);
            }
            $fullPath = $storageDir . DIRECTORY_SEPARATOR . $safeFilename;
            file_put_contents($fullPath, $decoded);
            $documentPath = "applications/{$safeFilename}";
        }

        $app = DB::transaction(function () use ($id, $validated, $documentPath, $request) {
            $created = ConnectionRequest::create([
                'id' => $id,
                'full_name' => $validated['fullName'],
                'phone' => $validated['phone'],
                'email' => $validated['email'] ?? null,
                'id_number' => $validated['idNumber'],
                'id_document_path' => $documentPath,
                'address' => $validated['address'],
                'package_id' => $validated['packageId'] ?? null,
                'package_name' => $validated['packageName'] ?? null,
                'ont_config' => $validated['ontConfig'] ?? null,
                'referral' => $validated['referral'] ?? null,
                'status' => 'pending',
                'raw_data' => [
                    'fullName' => $validated['fullName'],
                    'phone' => $validated['phone'],
                    'email' => $validated['email'] ?? null,
                    'address' => $validated['address'],
                    'idNumber' => $validated['idNumber'],
                    'packageId' => $validated['packageId'] ?? null,
                    'packageName' => $validated['packageName'] ?? null,
                    'hasDocument' => $documentPath !== null,
                ],
            ]);

            Notification::create([
                'id' => 'NTF-' . strtoupper(bin2hex(random_bytes(4))),
                'user_id' => 'admin',
                'recipient_type' => 'admin',
                'role_target' => 'super_admin',
                'type' => 'application',
                'title' => 'New Connection Application',
                'message' => "New fiber connection application {$id} from {$validated['fullName']}",
                'link' => '/orders',
                'is_read' => false,
                'raw_data' => ['applicationId' => $id],
                'created_at' => now(),
            ]);

            AuditLog::create([
                'actor_id' => $id,
                'actor_role' => 'subscriber',
                'action' => 'connection_request.created',
                'entity_type' => 'connection_request',
                'entity_id' => $id,
                'details' => ['package' => $validated['packageName'] ?? null],
                'ip_address' => $request->ip(),
                'created_at' => now(),
            ]);

            return $created;
        });

        return response()->json([
            'success' => true,
            'message' => 'Your connection request has been received.',
            'request' => [
                'id' => $app->id,
                'status' => $app->status,
                'createdAt' => $app->created_at ? $app->created_at->toIso8601String() : now()->toIso8601String(),
            ],
        ], 201);
    }

    /**
     * GET /api/applications
     * List all connection requests (staff only).
     */
    public function index(Request $request): JsonResponse
    {
        $query = ConnectionRequest::query();

        if ($request->has('status') && !empty($request->query('status'))) {
            $query->where('status', $request->query('status'));
        }

        $limit = min(500, max(1, (int) $request->query('limit', 100)));
        $requests = $query->orderBy('created_at', 'desc')->limit($limit)->get();

        return response()->json([
            'success' => true,
            'requests' => $requests,
        ]);
    }

    /**
     * PATCH /api/applications/{id}
     * Update connection request status (super_admin, billing only) with CSPRNG temp password (SEC-10, DB-04).
     */
    public function update(Request $request, string $id): JsonResponse
    {
        $app = ConnectionRequest::find($id);

        if (!$app) {
            return response()->json([
                'success' => false,
                'error' => 'Connection request not found',
            ], 404);
        }

        $validated = $request->validate([
            'status' => 'required|string|in:pending,approved,rejected,activated',
            'subscriberId' => 'nullable|string|max:100',
        ]);

        // Prevent duplicate approval/activation re-provisioning
        if (
            in_array($app->status, ['approved', 'activated'], true)
            && in_array($validated['status'], ['approved', 'activated'], true)
            && !empty($app->subscriber_id)
        ) {
            return response()->json([
                'success' => false,
                'error' => 'Connection request has already been approved or activated',
                'subscriberId' => $app->subscriber_id,
            ], 409);
        }

        $user = $request->attributes->get('user') ?? $request->user();
        $actorId = is_object($user) ? ($user->id ?? 'staff') : ($user['id'] ?? 'staff');
        $actorRole = is_object($user) ? ($user->role ?? 'staff') : ($user['role'] ?? 'staff');

        [$updatedApp, $tempPassword] = DB::transaction(function () use ($app, $validated, $actorId, $actorRole, $request) {
            $tempPassword = null;
            $subscriberId = $validated['subscriberId'] ?? $app->subscriber_id;

            if (in_array($validated['status'], ['approved', 'activated'], true) && empty($subscriberId)) {
                $subscriberId = 'NL-' . date('Y') . '-' . strtoupper(substr(bin2hex(random_bytes(4)), 0, 8));
                $tempPassword = 'Pass' . random_int(100000, 999999) . '!';

                $nameParts = preg_split('/\s+/', trim((string) $app->full_name), 2);
                $firstName = $nameParts[0] ?? 'Subscriber';
                $lastName = $nameParts[1] ?? '';

                $pkg = $app->package_id ? Package::find($app->package_id) : null;

                Subscriber::create([
                    'id' => $subscriberId,
                    'first_name' => $firstName,
                    'last_name' => $lastName,
                    'name' => $app->full_name,
                    'email' => $app->email,
                    'phone' => $app->phone,
                    'package_id' => $app->package_id,
                    'status' => $validated['status'] === 'activated' ? 'active' : 'registered',
                    'raw_data' => [
                        'firstName' => $firstName,
                        'lastName' => $lastName,
                        'address' => $app->address,
                        'packageId' => $app->package_id,
                        'packageName' => $pkg ? $pkg->name : $app->package_name,
                        'applicationId' => $app->id,
                    ],
                ]);

                // Resolve collision-safe username for subscriber_credentials
                $candidateUsername = $app->email ?: ($app->phone ?: $subscriberId);
                if (SubscriberCredential::where('username', $candidateUsername)->exists()) {
                    $candidateUsername = $subscriberId;
                }

                SubscriberCredential::create([
                    'subscriber_id' => $subscriberId,
                    'username' => $candidateUsername,
                    'password_hash' => Hash::make($tempPassword),
                    'legacy_password' => null,
                    'migrated_at' => now(),
                ]);

                SubscriberBilling::updateOrCreate(
                    ['subscriber_id' => $subscriberId],
                    [
                        'package_id' => $app->package_id,
                        'amount' => $pkg ? (float) $pkg->price : 0.0,
                        'currency' => 'USD',
                        'billing_start' => date('Y-m-01'),
                        'billing_end' => date('Y-m-t'),
                        'next_invoice_date' => date('Y-m-01', strtotime('+1 month')),
                        'auto_disconnect' => true,
                        'status' => $validated['status'] === 'activated' ? 'active' : 'inactive',
                    ]
                );

                $app->subscriber_id = $subscriberId;
            }

            $app->status = $validated['status'];
            $app->save();

            AuditLog::create([
                'actor_id' => $actorId,
                'actor_role' => $actorRole,
                'action' => 'connection_request.status_updated',
                'entity_type' => 'connection_request',
                'entity_id' => $app->id,
                'details' => [
                    'status' => $app->status,
                    'subscriberId' => $app->subscriber_id,
                ],
                'ip_address' => $request->ip(),
                'created_at' => now(),
            ]);

            return [$app, $tempPassword];
        });

        $response = [
            'success' => true,
            'request' => $updatedApp,
            'subscriberId' => $updatedApp->subscriber_id,
        ];

        if ($tempPassword !== null) {
            $response['temporaryPassword'] = $tempPassword;
        }

        return response()->json($response);
    }

    /**
     * GET /api/applications/{id}/document
     * Serve uploaded NID document strictly to super_admin with path traversal boundary check (SEC-09).
     */
    public function document(string $id): Response
    {
        $app = ConnectionRequest::find($id);

        if (!$app || empty($app->id_document_path)) {
            return response()->json([
                'success' => false,
                'error' => 'Document not found for this application',
            ], 404);
        }

        $basename = basename((string) $app->id_document_path);
        $candidateDirs = [
            storage_path('app/applications'),
            base_path('../api/storage/applications'),
        ];

        $resolvedFile = null;
        foreach ($candidateDirs as $dir) {
            $realDir = realpath($dir);
            if ($realDir === false) {
                continue;
            }
            $candidatePath = $realDir . DIRECTORY_SEPARATOR . $basename;
            $realCandidate = realpath($candidatePath);
            if (
                $realCandidate !== false
                && is_file($realCandidate)
                && str_starts_with($realCandidate, $realDir . DIRECTORY_SEPARATOR)
            ) {
                $resolvedFile = $realCandidate;
                break;
            }
        }

        if ($resolvedFile === null) {
            return response()->json([
                'success' => false,
                'error' => 'Document file is unavailable',
            ], 404);
        }

        $ext = strtolower(pathinfo($resolvedFile, PATHINFO_EXTENSION));
        $contentType = match ($ext) {
            'png' => 'image/png',
            'jpg', 'jpeg' => 'image/jpeg',
            'webp' => 'image/webp',
            'pdf' => 'application/pdf',
            default => 'application/octet-stream',
        };

        $binary = file_get_contents($resolvedFile);

        return response($binary, 200, [
            'Content-Type' => $contentType,
            'Content-Length' => strlen($binary),
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => 'private, no-store, max-age=0',
        ]);
    }
}
