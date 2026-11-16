<?php

namespace App\Models;

class ReferralCode extends BaseModel
{
    protected $table = 'referral_codes';
    protected $primaryKey = 'subscriber_id';

    protected $guarded = [];

    protected $casts = [
        'is_active' => 'boolean',
    ];

    public function subscriber()
    {
        return $this->belongsTo(Subscriber::class, 'subscriber_id', 'id');
    }
}
