<?php

namespace App\Models;

class ReferralReward extends BaseModel
{
    protected $table = 'referral_rewards';
    protected $primaryKey = 'id';

    protected $guarded = [];

    protected $casts = [
        'amount' => 'decimal:2',
        'credited_at' => 'datetime',
        'raw_data' => 'array',
    ];

    public function referral()
    {
        return $this->belongsTo(Referral::class, 'referral_id', 'id');
    }

    public function subscriber()
    {
        return $this->belongsTo(Subscriber::class, 'subscriber_id', 'id');
    }
}
