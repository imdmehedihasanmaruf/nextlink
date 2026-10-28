<?php

$storagePath = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR).DIRECTORY_SEPARATOR.'nextlink-laravel';

foreach (['app', 'framework/cache/data', 'framework/sessions', 'framework/views', 'logs'] as $directory) {
    $path = $storagePath.DIRECTORY_SEPARATOR.$directory;

    if (! is_dir($path) && ! mkdir($path, 0755, true) && ! is_dir($path)) {
        error_log('Unable to initialize Laravel runtime storage.');
        http_response_code(500);
        header('Content-Type: application/json');
        echo json_encode(['message' => 'The server could not initialize.']);
        exit;
    }
}

$_ENV['LARAVEL_STORAGE_PATH'] = $storagePath;
$_SERVER['LARAVEL_STORAGE_PATH'] = $storagePath;
$_SERVER['SCRIPT_NAME'] = '/index.php';

require __DIR__.'/../public/index.php';
