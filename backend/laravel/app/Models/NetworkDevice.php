<?php

namespace App\Models;

class NetworkDevice extends BaseModel
{
    protected $table = 'network_devices';
    protected $primaryKey = 'id';

    protected $guarded = [];

    protected $casts = [
        'raw_data' => 'array',
    ];
}
