<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class UserPreference extends Model
{
    protected $table = 'user_preferences';
    protected $primaryKey = 'user_id';
    public $incrementing = false;
    protected $keyType = 'string';

    public $timestamps = false;

    protected $guarded = [];

    protected $casts = [
        'auto_save' => 'boolean',
        'raw_data' => 'array',
        'updated_at' => 'datetime',
    ];
}
