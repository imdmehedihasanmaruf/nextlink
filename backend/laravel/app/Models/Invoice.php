<?php

namespace App\Models;

class Invoice extends BaseModel
{
    protected $table = 'invoices';
    protected $primaryKey = 'id';

    protected $guarded = [];

    protected $casts = [
        'amount' => 'decimal:2',
        'installation_fee' => 'decimal:2',
        'tax_fee' => 'decimal:2',
        'late_fee' => 'decimal:2',
        'carried_over_amount' => 'decimal:2',
        'late_fee_applied' => 'boolean',
        'raw_data' => 'array',
    ];

    public function subscriber()
    {
        return $this->belongsTo(Subscriber::class, 'subscriber_id');
    }

    public function transactions()
    {
        return $this->hasMany(PaymentTransaction::class, 'invoice_id');
    }

    public function events()
    {
        return $this->hasMany(BillingEvent::class, 'invoice_id');
    }
}
