<?php

namespace App\Models;

class TicketDetail extends BaseModel
{
    protected $table = 'ticket_details';
    protected $primaryKey = 'ticket_id';

    protected $guarded = [];

    protected $casts = [
        'sla_due_at' => 'datetime',
        'first_response_at' => 'datetime',
        'resolved_at' => 'datetime',
        'closed_at' => 'datetime',
        'raw_data' => 'array',
    ];

    public function ticket()
    {
        return $this->belongsTo(Ticket::class, 'ticket_id', 'id');
    }

    public function subscriber()
    {
        return $this->belongsTo(Subscriber::class, 'subscriber_id', 'id');
    }

    public function technician()
    {
        return $this->belongsTo(Technician::class, 'assigned_to', 'id');
    }
}
