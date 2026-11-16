<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class MikrotikSyncLog extends Model
{
    protected $table = 'mikrotik_sync_log';
    protected $primaryKey = 'id';
    public $incrementing = true;
    protected $keyType = 'int';

    public $timestamps = false;

    protected $guarded = [];

    protected $casts = [
        'request' => 'array',
        'response' => 'array',
        'created_at' => 'datetime',
    ];

    public function subscriber()
    {
        return $this->belongsTo(Subscriber::class, 'subscriber_id', 'id');
    }
}
