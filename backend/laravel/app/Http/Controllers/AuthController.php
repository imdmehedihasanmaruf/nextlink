<?php

namespace App\Http\Controllers;

use App\Services\AuthIdentityService;
use App\Services\JwtService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AuthController
{
    protected AuthIdentityService $identityService;
    protected JwtService $jwtService;

    public function __construct(AuthIdentityService $identityService, JwtService $jwtService)
    {
        $this->identityService = $identityService;
        $this->jwtService = $jwtService;
    }

    /**
     * POST /api/auth/login
     * Staff login endpoint.
     */
    public function login(Request $request): JsonResponse
    {
        $email = (string) $request->input('email', '');
        $password = (string) $request->input('password', '');

        if (empty($email) || empty($password)) {
            return response()->json([
                'success' => false,
                'error' => 'Email and password are required',
            ], 400);
        }

        $result = $this->identityService->authenticateStaff($email, $password, $request->ip());

        if (!$result['success']) {
            return response()->json([
                'success' => false,
                'error' => $result['error'],
            ], $result['status'] ?? 401);
        }

        $user = $result['user'];
        $token = $this->jwtService->sign([
            'id' => $user['id'],
            'email' => $user['email'],
            'name' => $user['name'],
            'role' => $user['role'],
            'type' => 'staff',
        ]);

        return response()->json([
            'success' => true,
            'token' => $token,
            'user' => $user,
        ]);
    }

    /**
     * POST /api/auth/subscriber-login
     * Subscriber login endpoint.
     */
    public function subscriberLogin(Request $request): JsonResponse
    {
        $identifier = (string) ($request->input('username') ?? $request->input('identifier') ?? $request->input('subscriberId') ?? $request->input('email') ?? '');
        $password = (string) $request->input('password', '');

        if (empty($identifier) || empty($password)) {
            return response()->json([
                'success' => false,
                'error' => 'Identifier and password are required',
            ], 400);
        }

        $result = $this->identityService->authenticateSubscriber($identifier, $password, $request->ip());

        if (!$result['success']) {
            return response()->json([
                'success' => false,
                'error' => $result['error'],
            ], $result['status'] ?? 401);
        }

        $user = $result['user'];
        $token = $this->jwtService->sign([
            'id' => $user['id'],
            'subscriberId' => $user['subscriberId'],
            'email' => $user['email'],
            'name' => $user['name'],
            'role' => 'subscriber',
            'type' => 'subscriber',
        ]);

        return response()->json([
            'success' => true,
            'token' => $token,
            'user' => $user,
            'subscriber' => $user,
            'subscriberId' => $user['subscriberId'],
        ]);
    }

    /**
     * GET /api/auth/me
     * Returns currently authenticated user identity.
     */
    public function me(Request $request): JsonResponse
    {
        $user = $request->attributes->get('user') ?? $request->user();

        return response()->json([
            'success' => true,
            'user' => $user,
        ]);
    }

    /**
     * GET /api/auth/session-meta
     */
    public function sessionMeta(Request $request): JsonResponse
    {
        $clientIp = $request->ip() ?: '127.0.0.1';
        $user = $request->attributes->get('user');
        $authenticated = (bool) $user;
        $nowYear = (int) date('Y');

        return response()->json([
            'success' => true,
            'version' => '1.0.0',
            'ip' => $clientIp,
            'rawIp' => $clientIp,
            'region' => 'Unknown',
            'lastLoginAt' => null,
            'lastLogin' => 'N/A',
            'authenticated' => $authenticated,
            'userMode' => $authenticated ? 'Enabled' : 'Disabled',
            'adminMode' => $authenticated ? 'Enabled' : 'Disabled',
            'encryption' => 'TLS 1.3 / AES-256-GCM',
            'copyrightYears' => "{$nowYear}–" . ($nowYear + 1),
        ]);
    }

    /**
     * GET /api/auth/permissions
     */
    public function permissions(Request $request): JsonResponse
    {
        $user = $request->attributes->get('user');
        $role = is_object($user) ? ($user->role ?? 'subscriber') : ($user['role'] ?? 'subscriber');

        return response()->json([
            'success' => true,
            'role' => $role,
            'permissions' => $role === 'super_admin' ? ['*'] : [],
        ]);
    }
}
