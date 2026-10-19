<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Payment extends Model
{
    protected $fillable = ['invoice_id', 'subscriber_id', 'method', 'transaction_reference', 'amount', 'status', 'verified_at', 'verified_by'];

    protected function casts(): array
    {
        return ['amount' => 'decimal:2', 'verified_at' => 'datetime'];
    }

    public function invoice(): BelongsTo { return $this->belongsTo(Invoice::class); }
    public function subscriber(): BelongsTo { return $this->belongsTo(Subscriber::class); }
    public function verifier(): BelongsTo { return $this->belongsTo(User::class, 'verified_by'); }
}
