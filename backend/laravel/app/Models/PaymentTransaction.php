<?php

namespace App\Models;

class PaymentTransaction extends BaseModel
{
    protected $table = 'payment_transactions';
    protected $primaryKey = 'id';

    protected $guarded = [];

    protected $casts = [
        'amount' => 'decimal:2',
        'raw_data' => 'array',
    ];

    public function invoice()
    {
        return $this->belongsTo(Invoice::class, 'invoice_id');
    }

    public function subscriber()
    {
        return $this->belongsTo(Subscriber::class, 'subscriber_id');
    }
}
