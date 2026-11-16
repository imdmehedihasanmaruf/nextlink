<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Payment Operating Mode
    |--------------------------------------------------------------------------
    | 'mock' simulates payments without external network calls.
    | 'live' executes real transactions against production payment gateways.
    */
    'mode' => env('PAYMENT_MODE', 'mock'),

    /*
    |--------------------------------------------------------------------------
    | Portal Public URL
    |--------------------------------------------------------------------------
    | Frontend client portal base URL used for hosted checkout and redirects.
    */
    'portal_public_url' => env('PORTAL_PUBLIC_URL', 'http://localhost:3000'),

    /*
    |--------------------------------------------------------------------------
    | Test Secret for Mock Gateway Signatures
    |--------------------------------------------------------------------------
    | HMAC-SHA256 signature key used strictly in development and test environments.
    */
    'mock_secret' => env('PAYMENT_MOCK_SECRET', 'nextlink-mock-secret'),

    /*
    |--------------------------------------------------------------------------
    | Gateway Configurations
    |--------------------------------------------------------------------------
    */
    'bkash' => [
        'base_url' => env('BKASH_BASE_URL', 'https://tokenized.sandbox.bka.sh/v1.2.0-beta'),
        'app_key' => env('BKASH_APP_KEY', ''),
        'app_secret' => env('BKASH_APP_SECRET', ''),
        'username' => env('BKASH_USERNAME', ''),
        'password' => env('BKASH_PASSWORD', ''),
    ],

    'nagad' => [
        'base_url' => env('NAGAD_BASE_URL', 'https://api.sandbox.nagad.com'),
        'merchant_id' => env('NAGAD_MERCHANT_ID', ''),
        'api_key' => env('NAGAD_API_KEY', ''),
    ],

    'sslcommerz' => [
        'base_url' => env('SSLCOMMERZ_BASE_URL', 'https://sandbox.sslcommerz.com'),
        'store_id' => env('SSLCOMMERZ_STORE_ID', ''),
        'store_password' => env('SSLCOMMERZ_STORE_PASSWORD', ''),
    ],

    'rocket' => [
        'base_url' => env('ROCKET_BASE_URL', 'https://sandbox.rocket.com/api/v1'),
        'merchant_id' => env('ROCKET_MERCHANT_ID', ''),
        'api_key' => env('ROCKET_API_KEY', ''),
    ],
];

