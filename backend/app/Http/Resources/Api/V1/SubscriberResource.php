<?php

namespace App\Http\Resources\Api\V1;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class SubscriberResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'subscriber_number' => $this->subscriber_number,
            'name' => $this->user?->name,
            'email' => $this->user?->email,
            'phone' => $this->phone,
            'address' => $this->address,
            'connection_type' => $this->connection_type,
            'ip_address' => $this->ip_address,
            'status' => $this->status,
            'package_id' => $this->package_id,
            'package_name' => $this->package?->name,
            'created_at' => $this->created_at,
        ];
    }
}
