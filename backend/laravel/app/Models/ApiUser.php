<?php

namespace App\Models;

use Illuminate\Auth\Authenticatable;
use Illuminate\Contracts\Auth\Authenticatable as AuthenticatableContract;

class ApiUser extends BaseModel implements AuthenticatableContract
{
    use Authenticatable;

    protected $table = 'api_users';
    protected $primaryKey = 'id';

    protected $guarded = [];

    protected $hidden = [
        'password_hash',
    ];

    protected $casts = [
        'last_login_at' => 'datetime',
        'previous_login_at' => 'datetime',
    ];

    /**
     * Get the password for authentication.
     */
    public function getAuthPassword(): string
    {
        return $this->password_hash ?? '';
    }
}
