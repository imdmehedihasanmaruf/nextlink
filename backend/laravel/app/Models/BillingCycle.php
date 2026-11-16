<?php

namespace App\Models;

class BillingCycle extends BaseModel
{
    protected $table = 'billing_cycles';
    protected $primaryKey = 'id';

    public $timestamps = false;

    protected $guarded = [];

    protected $casts = [
        'invoice_count' => 'integer',
        'total_amount' => 'decimal:2',
        'collected_amount' => 'decimal:2',
        'details' => 'array',
        'started_at' => 'datetime',
        'completed_at' => 'datetime',
    ];
}
