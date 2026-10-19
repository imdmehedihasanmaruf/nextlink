<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Package extends Model
{
    protected $fillable = ['name', 'description', 'download_mbps', 'upload_mbps', 'bdix_mbps', 'price_monthly', 'installation_fee', 'features', 'is_active'];

    protected function casts(): array
    {
        return ['features' => 'array', 'is_active' => 'boolean', 'price_monthly' => 'decimal:2', 'installation_fee' => 'decimal:2'];
    }

    public function subscribers(): HasMany
    {
        return $this->hasMany(Subscriber::class);
    }
}
