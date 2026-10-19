<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    public function login(Request $request): JsonResponse
    {
        $credentials = $request->validate(['email' => ['required', 'email'], 'password' => ['required', 'string']]);
        if (! Auth::attempt($credentials)) {
            throw ValidationException::withMessages(['email' => ['The provided credentials are incorrect.']]);
        }

        $user = Auth::user();
        if (! $user) {
            throw ValidationException::withMessages(['email' => ['The provided credentials are incorrect.']]);
        }
        $user->tokens()->delete();

        return response()->json(['success' => true, 'message' => 'Login successful.', 'data' => ['user' => $user->load('subscriber'), 'token' => $user->createToken('frontend')->plainTextToken]]);
    }

    public function me(Request $request): JsonResponse
    {
        $user = $request->user()->load('subscriber');
        return response()->json(['success' => true, 'data' => ['user' => $user->toArray() + ['avatar_url' => $user->avatar_path ? Storage::disk('public')->url($user->avatar_path) : null]]]);
    }

    public function updateProfile(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'avatar' => ['nullable', 'image', 'max:2048'],
        ]);
        $user = $request->user();
        $user->name = $data['name'];
        if ($request->hasFile('avatar')) {
            if ($user->avatar_path) Storage::disk('public')->delete($user->avatar_path);
            $user->avatar_path = $request->file('avatar')->store('avatars', 'public');
        }
        $user->save();
        $user = $user->fresh()->load('subscriber');
        return response()->json(['success' => true, 'message' => 'Profile updated successfully.', 'data' => ['user' => $user->toArray() + ['avatar_url' => $user->avatar_path ? Storage::disk('public')->url($user->avatar_path) : null]]]);
    }

    public function logout(Request $request): JsonResponse
    {
        if ($request->user()->currentAccessToken()) {
            $request->user()->currentAccessToken()->delete();
        }
        return response()->json(['success' => true, 'message' => 'Logged out successfully.']);
    }

    public function updatePassword(Request $request): JsonResponse
    {
        $data = $request->validate(['current_password' => ['required', 'current_password'], 'password' => ['required', 'confirmed', 'string', 'min:12']]);
        $request->user()->update(['password' => Hash::make($data['password'])]);
        $request->user()->tokens()->delete();
        return response()->json(['success' => true, 'message' => 'Password updated. Please log in again.']);
    }
}
