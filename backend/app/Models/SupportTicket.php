<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class SupportTicket extends Model
{
    protected $fillable = ['subscriber_id', 'assigned_to', 'subject', 'description', 'priority', 'status', 'sla_due_at'];

    protected function casts(): array
    {
        return ['sla_due_at' => 'datetime'];
    }

    public function subscriber(): BelongsTo { return $this->belongsTo(Subscriber::class); }
    public function assignee(): BelongsTo { return $this->belongsTo(User::class, 'assigned_to'); }
    public function messages(): HasMany { return $this->hasMany(TicketMessage::class, 'ticket_id'); }
}
