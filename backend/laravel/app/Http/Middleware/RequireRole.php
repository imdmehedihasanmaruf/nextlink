<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class RequireRole
{
    /**
     * Handle an incoming request.
     *
     * @param  \Closure(\Illuminate\Http\Request): (\Symfony\Component\HttpFoundation\Response)  $next
     * @param  string  ...$roles
     */
    public function handle(Request $request, Closure $next, ...$roles): Response
    {
        $user = $request->attributes->get('user') ?? $request->user();

        if (!$user) {
            return response()->json([
                'success' => false,
                'error' => 'Authentication required',
            ], 401);
        }

        $userRole = is_object($user) ? ($user->role ?? null) : ($user['role'] ?? null);

        // Super Admin always has full access
        if ($userRole === 'super_admin') {
            return $next($request);
        }

        // Check if user has any of the requested roles
        if (!in_array($userRole, $roles, true)) {
            return response()->json([
                'success' => false,
                'error' => 'This action requires one of the following roles: ' . implode(', ', $roles),
            ], 403);
        }

        return $next($request);
    }
}
