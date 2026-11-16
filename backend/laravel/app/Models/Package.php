<?php

namespace App\Models;

class Package extends BaseModel
{
    protected $table = 'packages';
    protected $primaryKey = 'id';

    protected $guarded = [];

    protected $casts = [
        'speed' => 'integer',
        'upload_speed' => 'integer',
        'price' => 'decimal:2',
        'popular' => 'boolean',
        'features' => \App\Casts\PostgresTextArray::class,
        'raw_data' => 'array',
    ];

    public function subscribers()
    {
        return $this->hasMany(Subscriber::class, 'package_id');
    }

    public function orders()
    {
        return $this->hasMany(Order::class, 'package_id');
    }
}
