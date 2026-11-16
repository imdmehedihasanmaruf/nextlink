<?php

namespace App\Models;

class ConnectionRequest extends BaseModel
{
    protected $table = 'connection_requests';
    protected $primaryKey = 'id';

    protected $guarded = [];

    protected $casts = [
        'raw_data' => 'array',
    ];

    public function subscriber()
    {
        return $this->belongsTo(Subscriber::class, 'subscriber_id', 'id');
    }

    public function package()
    {
        return $this->belongsTo(Package::class, 'package_id', 'id');
    }
}
