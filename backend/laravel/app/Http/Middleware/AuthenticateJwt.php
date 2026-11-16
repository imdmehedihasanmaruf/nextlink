<?php

namespace App\Http\Middleware;

use App\Services\AuthIdentityService;
use App\Services\JwtService;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class AuthenticateJwt
{
    protected JwtService $jwtService;
    protected AuthIdentityService $identityService;

    public function __construct(JwtService $jwtService, AuthIdentityService $identityService)
    {
        $this->jwtService = $jwtService;
        $this->identityService = $identityService;
    }

    /**
     * Handle an incoming request.
     */
    public function handle(Request $request, Closure $next): Response
    {
        $token = $this->extractToken($request);

        if (!empty($token)) {
            try {
                $payload = $this->jwtService->verify($token);
            } catch (\Throwable $e) {
                return response()->json([
                    'success' => false,
                    'error' => 'Invalid or expired token',
                ], 401);
            }

            $user = $this->identityService->resolveIdentity($payload);
            if (!$user) {
                return response()->json([
                    'success' => false,
                    'error' => 'Account is not active or user not found',
                ], 401);
            }

            $userObj = (object) $user;

            $request->attributes->set('user', $userObj);
            $request->attributes->set('auth_user', $user);
            $request->setUserResolver(function () use ($userObj) {
                return $userObj;
            });

            return $next($request);
        }

        // Strict guard on x-subscriber-id development fallback header (SEC-01)
        $subHeader = $request->header('x-subscriber-id');
        if (!empty($subHeader)) {
            $isProduction = config('app.env') === 'production'
                || strtolower((string) $request->header('X-Simulate-Production', '')) === 'true';

            if ($isProduction) {
                return response()->json([
                    'success' => false,
                    'error' => 'Authentication required. Bearer token is mandatory in production.',
                ], 401);
            }

            $allowDevHeader = config('app.debug') === true
                && (strtolower((string) $request->header('X-Allow-Dev-Subscriber', '')) === 'true'
                    || config('jwt.allow_dev_header') === true);

            if (!$allowDevHeader) {
                return response()->json([
                    'success' => false,
                    'error' => 'Authentication required. Unauthenticated x-subscriber-id header is disabled without explicit dev opt-in.',
                ], 401);
            }

            $resolvedSub = $this->identityService->resolveIdentity([
                'id' => (string) $subHeader,
                'subscriberId' => (string) $subHeader,
                'role' => 'subscriber',
                'type' => 'subscriber',
            ]);

            if (!$resolvedSub) {
                return response()->json([
                    'success' => false,
                    'error' => 'Subscriber account not found',
                ], 401);
            }

            $subUser = (object) $resolvedSub;
            $request->attributes->set('user', $subUser);
            $request->attributes->set('auth_user', $resolvedSub);
            $request->setUserResolver(function () use ($subUser) {
                return $subUser;
            });

            return $next($request);
        }

        return response()->json([
            'success' => false,
            'error' => 'Authentication required',
        ], 401);
    }

    /**
     * Extract token from Authorization header or custom header.
     */
    protected function extractToken(Request $request): ?string
    {
        $authHeader = $request->header('Authorization', '');
        if (str_starts_with($authHeader, 'Bearer ')) {
            return trim(substr($authHeader, 7));
        }

        $xAuth = $request->header('x-auth-token');
        if (!empty($xAuth)) {
            return trim((string) $xAuth);
        }

        if (!empty($authHeader) && substr_count($authHeader, '.') === 2) {
            return trim($authHeader);
        }

        return null;
    }
}
