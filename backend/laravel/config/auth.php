<?php

return [
    'defaults' => [
        'guard' => env('AUTH_GUARD', 'api'),
        'passwords' => 'users',
    ],

    'guards' => [
        'api' => [
            'driver' => 'jwt',
            'provider' => 'api_users',
        ],
        'subscribers' => [
            'driver' => 'jwt',
            'provider' => 'subscriber_credentials',
        ],
    ],

    'providers' => [
        'api_users' => [
            'driver' => 'eloquent',
            'model' => App\Models\ApiUser::class,
        ],
        'subscriber_credentials' => [
            'driver' => 'eloquent',
            'model' => App\Models\SubscriberCredential::class,
        ],
    ],

    'passwords' => [
        'users' => [
            'provider' => 'api_users',
            'table' => 'password_reset_tokens',
            'expire' => 60,
            'throttle' => 60,
        ],
    ],

    'password_timeout' => env('AUTH_PASSWORD_TIMEOUT', 10800),
];
