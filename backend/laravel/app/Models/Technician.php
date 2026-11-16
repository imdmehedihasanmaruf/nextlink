<?php

namespace App\Models;

class Technician extends BaseModel
{
    protected $table = 'technicians';
    protected $primaryKey = 'id';

    protected $guarded = [];

    protected $casts = [
        'raw_data' => 'array',
    ];

    public function assignedTickets()
    {
        return $this->hasMany(TicketDetail::class, 'assigned_to', 'id');
    }
}
