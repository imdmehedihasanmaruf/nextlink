<?php

namespace App\Models;

class Referral extends BaseModel
{
    protected $table = 'referrals';
    protected $primaryKey = 'id';

    protected $guarded = [];

    protected $casts = [
        'reward_amount' => 'decimal:2',
        'qualified_at' => 'datetime',
        'credited_at' => 'datetime',
        'raw_data' => 'array',
    ];

    public function referrer()
    {
        return $this->belongsTo(Subscriber::class, 'referrer_id', 'id');
    }

    public function referredSubscriber()
    {
        return $this->belongsTo(Subscriber::class, 'referred_subscriber_id', 'id');
    }

    public function reward()
    {
        return $this->hasOne(ReferralReward::class, 'referral_id', 'id');
    }
}
