<?php

namespace App\Models;

class Order extends BaseModel
{
    protected $table = 'orders';
    protected $primaryKey = 'id';

    protected $guarded = [];

    protected $casts = [
        'download_speed' => 'integer',
        'upload_speed' => 'integer',
        'monthly_price' => 'decimal:2',
        'prorated_adjustment' => 'decimal:2',
        'installation_fee' => 'decimal:2',
        'taxes' => 'decimal:2',
        'discount' => 'decimal:2',
        'total_payable' => 'decimal:2',
        'raw_data' => 'array',
    ];

    public function subscriber()
    {
        return $this->belongsTo(Subscriber::class, 'customer_id', 'id');
    }

    public function package()
    {
        return $this->belongsTo(Package::class, 'package_id', 'id');
    }
}
