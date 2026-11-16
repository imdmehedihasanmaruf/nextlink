<?php

namespace App\Models;

class Cancellation extends BaseModel
{
    protected $table = 'cancellations';
    protected $primaryKey = 'id';

    protected $guarded = [];

    protected $casts = [
        'not_sure_buy_again' => 'boolean',
        'outstanding_balance' => 'decimal:2',
        'raw_data' => 'array',
    ];

    public function subscriber()
    {
        return $this->belongsTo(Subscriber::class, 'subscriber_id', 'id');
    }

    public function package()
    {
        return $this->belongsTo(Package::class, 'package_id', 'id');
    }
}
