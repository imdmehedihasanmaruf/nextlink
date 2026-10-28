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

if ((getenv('APP_ENV') ?: 'production') === 'production') {
    ini_set('display_errors', '0');
}

register_shutdown_function(static function (): void {
    $error = error_get_last();
    $fatalTypes = [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR];

    if ($error === null || ! in_array($error['type'], $fatalTypes, true)) {
        return;
    }

    error_log(sprintf('PHP fatal error: %s at %s:%d', $error['message'], $error['file'], $error['line']));

    if (! headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
    }

    echo json_encode(['message' => 'The server encountered an internal error.']);
});

try {
    require __DIR__.'/../public/index.php';
} catch (Throwable $exception) {
    error_log(sprintf(
        'Uncaught Laravel request exception [%s]: %s at %s:%d',
        $exception::class,
        $exception->getMessage(),
        $exception->getFile(),
        $exception->getLine(),
    ));

    if (! headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
    }

    echo json_encode(['message' => 'The server encountered an internal error.']);
}
