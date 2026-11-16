<?php

namespace App\Models;

class SubscriberBilling extends BaseModel
{
    protected $table = 'subscriber_billing';
    protected $primaryKey = 'subscriber_id';

    protected $guarded = [];

    protected $casts = [
        'amount' => 'decimal:2',
        'auto_disconnect' => 'boolean',
        'billing_start' => 'date',
        'billing_end' => 'date',
        'next_invoice_date' => 'date',
        'raw_data' => 'array',
    ];

    public function subscriber()
    {
        return $this->belongsTo(Subscriber::class, 'subscriber_id');
    }

    public function package()
    {
        return $this->belongsTo(Package::class, 'package_id');
    }
}
