<?php

return [
    'name' => 'Laravel on ConoHa',
    'env' => env('APP_ENV', 'production'),
    'debug' => (bool) env('APP_DEBUG', false),
    'url' => env('APP_URL', 'http://localhost'),
    'timezone' => 'Asia/Tokyo',
    'locale' => 'en',
    'key' => env('APP_KEY'),
    'maintenance' => ['driver' => 'file'],
];
