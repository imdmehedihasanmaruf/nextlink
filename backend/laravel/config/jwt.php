<?php

return [
    'secret' => env('JWT_SECRET', 'nextlink-dev-secret-change-me'),
    'ttl' => env('JWT_TTL', 604800), // 7 days in seconds
    'algo' => 'HS256',
    'allow_dev_header' => (bool) env('JWT_ALLOW_DEV_HEADER', false),
];
