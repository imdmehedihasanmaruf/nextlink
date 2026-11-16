<?php

namespace App\Models;

class CoverageArea extends BaseModel
{
    protected $table = 'coverage_areas';
    protected $primaryKey = 'id';

    protected $guarded = [];

    protected $casts = [
        'areas' => \App\Casts\PostgresTextArray::class,
        'lat' => 'decimal:7',
        'lng' => 'decimal:7',
        'raw_data' => 'array',
    ];
}
