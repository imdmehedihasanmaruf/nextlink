<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class RequireSelfOrRole
{
    /**
     * Handle an incoming request.
     *
     * @param  \Closure(\Illuminate\Http\Request): (\Symfony\Component\HttpFoundation\Response)  $next
     * @param  string  ...$staffRoles
     */
    public function handle(Request $request, Closure $next, ...$staffRoles): Response
    {
        $user = $request->attributes->get('user') ?? $request->user();

        if (!$user) {
            return response()->json([
                'success' => false,
                'error' => 'Authentication required',
            ], 401);
        }

        $userRole = is_object($user) ? ($user->role ?? null) : ($user['role'] ?? null);
        $userType = is_object($user) ? ($user->type ?? null) : ($user['type'] ?? null);

        if ($userRole === 'super_admin') {
            return $next($request);
        }

        if ($userType === 'subscriber' || $userRole === 'subscriber') {
            return $next($request);
        }

        if (in_array($userRole, $staffRoles, true)) {
            return $next($request);
        }

        return response()->json([
            'success' => false,
            'error' => 'This action requires one of the following roles: ' . implode(', ', $staffRoles),
        ], 403);
    }
}
