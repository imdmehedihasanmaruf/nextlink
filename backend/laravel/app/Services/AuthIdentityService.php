<?php

namespace App\Services;

use App\Models\AdminUser;
use App\Models\ApiUser;
use App\Models\Subscriber;
use App\Models\SubscriberCredential;
use Illuminate\Support\Facades\Hash;

class AuthIdentityService
{
    /**
     * Authenticate staff member by email & password.
     */
    public function authenticateStaff(string $email, string $password, ?string $clientIp = null): array
    {
        $email = strtolower(trim($email));
        $user = ApiUser::where('email', $email)->first();

        if (!$user) {
            return ['success' => false, 'error' => 'Invalid email or password', 'status' => 401];
        }

        if ($user->status !== 'active') {
            return ['success' => false, 'error' => 'Account is not active', 'status' => 403];
        }

        $isValid = false;
        try {
            $isValid = Hash::check($password, $user->password_hash);
        } catch (\Throwable $e) {
            $isValid = password_verify($password, $user->password_hash);
        }

        if (!$isValid) {
            return ['success' => false, 'error' => 'Invalid email or password', 'status' => 401];
        }

        $user->previous_login_at = $user->last_login_at ?? now();
        $user->last_login_at = now();
        if ($clientIp) {
            $user->last_login_ip = $clientIp;
        }
        $user->save();

        return [
            'success' => true,
            'user' => [
                'id' => $user->id,
                'email' => $user->email,
                'name' => $user->name,
                'role' => $user->role,
                'type' => 'staff',
            ],
        ];
    }

    /**
     * Authenticate subscriber by identifier (subscriber id, username, email, phone) & password.
     */
    public function authenticateSubscriber(string $identifier, string $password, ?string $clientIp = null): array
    {
        $identifier = trim($identifier);
        if (empty($identifier) || empty($password)) {
            return ['success' => false, 'error' => 'Invalid credentials', 'status' => 401];
        }

        // 1. Try finding in subscriber_credentials (by username or subscriber_id)
        $cred = SubscriberCredential::where('username', $identifier)
            ->orWhere('subscriber_id', $identifier)
            ->first();

        $subscriberId = null;

        if ($cred && !empty($cred->password_hash)) {
            $isValid = false;
            try {
                $isValid = Hash::check($password, $cred->password_hash);
            } catch (\Throwable $e) {
                $isValid = password_verify($password, $cred->password_hash);
            }
            if ($isValid) {
                $subscriberId = $cred->subscriber_id;
            }
        }

        // 2. If not matched in credentials, check subscriber record directly (by email, phone, or id)
        if (!$subscriberId) {
            $sub = Subscriber::where('id', $identifier)
                ->orWhere('email', $identifier)
                ->orWhere('phone', $identifier)
                ->first();

            if ($sub) {
                $subCred = SubscriberCredential::where('subscriber_id', $sub->id)->first();
                $isValid = false;
                if ($subCred && !empty($subCred->password_hash)) {
                    try {
                        $isValid = Hash::check($password, $subCred->password_hash);
                    } catch (\Throwable $e) {
                        $isValid = password_verify($password, $subCred->password_hash);
                    }
                }
                if ($isValid) {
                    $subscriberId = $sub->id;
                    $cred = $subCred;
                } else {
                    $rawData = is_array($sub->raw_data) ? $sub->raw_data : json_decode($sub->raw_data ?? '{}', true);
                    $legacyPass = $rawData['password'] ?? null;
                    if ($legacyPass !== null && $legacyPass !== '' && hash_equals((string) $legacyPass, (string) $password)) {
                        $subscriberId = $sub->id;
                        $candidateUser = $sub->email ?? $sub->phone ?? $sub->id;
                        if (SubscriberCredential::where('username', $candidateUser)->where('subscriber_id', '!=', $sub->id)->exists()) {
                            $candidateUser = $candidateUser . '-' . $sub->id;
                        }
                        SubscriberCredential::updateOrCreate(
                            ['subscriber_id' => $sub->id],
                            [
                                'username' => $candidateUser,
                                'password_hash' => Hash::make($password),
                                'legacy_password' => null,
                                'migrated_at' => now(),
                            ]
                        );
                        $rawData['password'] = '';
                        $sub->raw_data = $rawData;
                        $sub->save();
                    }
                }
            }
        }

        if (!$subscriberId) {
            return ['success' => false, 'error' => 'No account matches those credentials', 'status' => 404];
        }

        $subscriber = Subscriber::find($subscriberId);
        if (!$subscriber) {
            return ['success' => false, 'error' => 'Subscriber not found', 'status' => 404];
        }

        if ($cred) {
            $cred->previous_login_at = $cred->last_login_at ?? now();
            $cred->last_login_at = now();
            if ($clientIp) {
                $cred->last_login_ip = $clientIp;
            }
            $cred->save();
        }

        return [
            'success' => true,
            'user' => [
                'id' => $subscriber->id,
                'name' => $subscriber->name,
                'email' => $subscriber->email,
                'role' => 'subscriber',
                'type' => 'subscriber',
                'subscriberId' => $subscriber->id,
            ],
        ];
    }

    /**
     * Resolve user identity from decoded JWT payload against the database (SEC-13).
     * Never trusts unverified stateless claims when no matching database record exists.
     */
    public function resolveIdentity(array $payload): ?array
    {
        $id = isset($payload['id']) ? trim((string) $payload['id']) : '';
        $role = isset($payload['role']) ? trim((string) $payload['role']) : '';
        $type = $payload['type'] ?? (strtolower($role) === 'subscriber' ? 'subscriber' : 'staff');
        $subscriberId = isset($payload['subscriberId']) ? trim((string) $payload['subscriberId']) : ($type === 'subscriber' ? $id : '');
        $email = isset($payload['email']) ? strtolower(trim((string) $payload['email'])) : '';

        if ($id === '' && $subscriberId === '' && $email === '') {
            return null;
        }

        // Subscriber identity resolution against database
        if ($type === 'subscriber' || strtolower($role) === 'subscriber') {
            $lookupKey = $subscriberId !== '' ? $subscriberId : $id;
            $subscriber = Subscriber::find($lookupKey);

            if (!$subscriber && $lookupKey !== '') {
                $cred = SubscriberCredential::where('username', $lookupKey)
                    ->orWhere('subscriber_id', $lookupKey)
                    ->first();
                if ($cred) {
                    $subscriber = Subscriber::find($cred->subscriber_id);
                }
            }

            if (!$subscriber && $email !== '') {
                $subscriber = Subscriber::whereRaw('LOWER(email) = ?', [$email])->first();
            }

            if (!$subscriber) {
                return null;
            }

            return [
                'id' => $subscriber->id,
                'role' => 'subscriber',
                'type' => 'subscriber',
                'subscriberId' => $subscriber->id,
                'email' => $subscriber->email,
                'name' => $subscriber->name,
            ];
        }

        // Staff identity resolution against database
        $staff = $id !== '' ? ApiUser::find($id) : null;
        if (!$staff && $email !== '') {
            $staff = ApiUser::whereRaw('LOWER(email) = ?', [$email])->first();
        }

        if ($staff) {
            if ($staff->status !== 'active') {
                return null;
            }

            return [
                'id' => $staff->id,
                'role' => $staff->role,
                'type' => 'staff',
                'subscriberId' => null,
                'email' => $staff->email,
                'name' => $staff->name,
            ];
        }

        // Secondary check in admin_users table
        $adminUser = $id !== '' ? AdminUser::find($id) : null;
        if (!$adminUser && $email !== '') {
            $adminUser = AdminUser::whereRaw('LOWER(email) = ?', [$email])->first();
        }

        if ($adminUser) {
            if ($adminUser->status !== 'active') {
                return null;
            }

            return [
                'id' => $adminUser->id,
                'role' => $role !== '' ? $role : $adminUser->role,
                'type' => 'staff',
                'subscriberId' => null,
                'email' => $adminUser->email,
                'name' => $adminUser->name,
            ];
        }

        return null;
    }
}
