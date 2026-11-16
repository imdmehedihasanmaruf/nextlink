<?php

namespace App\Models;

class TurboBoostRequest extends BaseModel
{
    protected $table = 'turbo_boost_requests';
    protected $primaryKey = 'id';

    protected $guarded = [];

    protected $casts = [
        'duration_hours' => 'integer',
        'requested_mbps' => 'integer',
        'decided_at' => 'datetime',
        'applied_at' => 'datetime',
        'expires_at' => 'datetime',
        'deactivated_at' => 'datetime',
        'raw_data' => 'array',
    ];

    public function subscriber()
    {
        return $this->belongsTo(Subscriber::class, 'subscriber_id', 'id');
    }
}
