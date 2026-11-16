<?php

namespace App\Models;

class Ticket extends BaseModel
{
    protected $table = 'tickets';
    protected $primaryKey = 'id';

    protected $guarded = [];

    protected $casts = [
        'raw_data' => 'array',
    ];

    public function detail()
    {
        return $this->hasOne(TicketDetail::class, 'ticket_id', 'id');
    }

    public function messages()
    {
        return $this->hasMany(TicketMessage::class, 'ticket_id', 'id')->orderBy('created_at', 'asc');
    }
}
