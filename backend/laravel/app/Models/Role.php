<?php

namespace App\Models;

class Role extends BaseModel
{
    protected $table = 'roles';
    protected $primaryKey = 'id';

    protected $guarded = [];

    protected $casts = [
        'raw_data' => 'array',
    ];

    public function adminUsers()
    {
        return $this->hasMany(AdminUser::class, 'role', 'name');
    }
}
