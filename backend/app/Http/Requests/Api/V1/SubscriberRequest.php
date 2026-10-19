<?php

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class SubscriberRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    public function rules(): array
    {
        $subscriber = $this->route('subscriber');
        return [
            'name' => [$this->isMethod('POST') ? 'required' : 'sometimes', 'string', 'max:255'],
            'email' => [$this->user()?->role === 'subscriber' ? 'prohibited' : ($this->isMethod('POST') ? 'required' : 'sometimes'), 'email', 'max:255', Rule::unique('users', 'email')->ignore($subscriber?->user_id)],
            'phone' => ['sometimes', 'nullable', 'string', 'max:32'],
            'address' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'connection_type' => ['sometimes', Rule::in(['pppoe', 'static_ip'])],
            'ip_address' => [$this->user()?->role === 'subscriber' ? 'prohibited' : 'sometimes', 'nullable', 'ip'],
            'package_id' => [$this->isMethod('POST') ? 'sometimes' : 'prohibited', 'integer', 'exists:packages,id'],
            'status' => [$this->user()?->role === 'subscriber' ? 'prohibited' : 'sometimes', Rule::in(['pending', 'active', 'suspended'])],
        ];
    }
}
