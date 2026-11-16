<?php

namespace App\Models;

class SubscriberCredential extends BaseModel
{
    protected $table = 'subscriber_credentials';
    protected $primaryKey = 'subscriber_id';

    protected $guarded = [];

    protected $hidden = [
        'password_hash',
        'legacy_password',
    ];

    protected $casts = [
        'previous_login_at' => 'datetime',
        'last_login_at' => 'datetime',
        'raw_data' => 'array',
    ];

    public function subscriber()
    {
        return $this->belongsTo(Subscriber::class, 'subscriber_id');
    }
}
