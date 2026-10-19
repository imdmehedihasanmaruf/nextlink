<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Invoice extends Model
{
    protected $fillable = ['subscriber_id', 'invoice_number', 'amount', 'billing_period_start', 'billing_period_end', 'due_date', 'paid_at', 'status'];

    protected function casts(): array
    {
        return ['amount' => 'decimal:2', 'billing_period_start' => 'date', 'billing_period_end' => 'date', 'due_date' => 'date', 'paid_at' => 'datetime'];
    }

    public function subscriber(): BelongsTo { return $this->belongsTo(Subscriber::class); }
    public function payments(): HasMany { return $this->hasMany(Payment::class); }
}
