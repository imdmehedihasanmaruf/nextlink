<?php

namespace App\Models;

class AdminUser extends BaseModel
{
    protected $table = 'admin_users';
    protected $primaryKey = 'id';

    protected $guarded = [];

    protected $hidden = [
        'password',
        'password_hash',
        'legacy_password',
    ];

    protected $casts = [
        'raw_data' => 'array',
    ];

    public function toArray(): array
    {
        $array = parent::toArray();
        if (isset($array['raw_data']) && is_array($array['raw_data'])) {
            unset(
                $array['raw_data']['password'],
                $array['raw_data']['password_hash'],
                $array['raw_data']['legacy_password'],
                $array['raw_data']['tempPassword']
            );
        }

        return $array;
    }

    public function roleModel()
    {
        return $this->belongsTo(Role::class, 'role', 'name');
    }
}
