<?php

namespace App\Policies;

use App\Models\Subscriber;
use App\Models\User;

class SubscriberPolicy
{
    private const STAFF_ROLES = ['super_admin', 'accounts_billing', 'support_helpdesk', 'field_technician'];

    public function viewAny(User $user): bool
    {
        return in_array($user->role, self::STAFF_ROLES, true);
    }

    public function view(User $user, Subscriber $subscriber): bool
    {
        return in_array($user->role, self::STAFF_ROLES, true) || ($user->role === 'subscriber' && $subscriber->user_id === $user->id);
    }

    public function create(User $user): bool
    {
        return in_array($user->role, ['super_admin', 'accounts_billing'], true);
    }

    public function update(User $user, Subscriber $subscriber): bool
    {
        return in_array($user->role, ['super_admin', 'accounts_billing'], true) || ($user->role === 'subscriber' && $subscriber->user_id === $user->id);
    }

    public function delete(User $user): bool
    {
        return $user->role === 'super_admin';
    }
}
