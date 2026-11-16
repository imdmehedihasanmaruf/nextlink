<?php

namespace App\Models;

class Subscriber extends BaseModel
{
    protected $table = 'subscribers';
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

    public function package()
    {
        return $this->belongsTo(Package::class, 'package_id');
    }

    public function billingProfile()
    {
        return $this->hasOne(SubscriberBilling::class, 'subscriber_id');
    }

    public function credentials()
    {
        return $this->hasOne(SubscriberCredential::class, 'subscriber_id');
    }

    public function invoices()
    {
        return $this->hasMany(Invoice::class, 'subscriber_id');
    }

    public function orders()
    {
        return $this->hasMany(Order::class, 'customer_id');
    }

    public function tickets()
    {
        return $this->hasMany(Ticket::class, 'subscriber_id');
    }

    public function cancellations()
    {
        return $this->hasMany(Cancellation::class, 'subscriber_id');
    }

    public function preferences()
    {
        return $this->hasOne(UserPreference::class, 'user_id');
    }
}
