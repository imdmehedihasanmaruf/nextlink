<?php

$storagePath = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR).DIRECTORY_SEPARATOR.'nextlink-laravel';

foreach (['app', 'bootstrap/cache', 'framework/cache/data', 'framework/sessions', 'framework/views', 'logs'] as $directory) {
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

if (empty(getenv('APP_KEY'))) {
    $defaultKey = 'base64:'.base64_encode(random_bytes(32));
    $_ENV['APP_KEY'] = $defaultKey;
    $_SERVER['APP_KEY'] = $defaultKey;
    putenv('APP_KEY='.$defaultKey);
}

if (empty(getenv('DB_CONNECTION')) || getenv('DB_CONNECTION') === 'sqlite') {
    $dbPath = $storagePath . DIRECTORY_SEPARATOR . 'database.sqlite';
    if (!file_exists($dbPath)) {
        touch($dbPath);
    }
    $_ENV['DB_DATABASE'] = $dbPath;
    $_SERVER['DB_DATABASE'] = $dbPath;
    putenv('DB_DATABASE=' . $dbPath);
}

$cachePath = $storagePath.DIRECTORY_SEPARATOR.'bootstrap'.DIRECTORY_SEPARATOR.'cache';

if (DIRECTORY_SEPARATOR === '\\' && preg_match('/^[A-Za-z]:/', $cachePath) === 1) {
    $cachePath = substr($cachePath, 2);
}

foreach (['APP_CONFIG_CACHE' => 'config.php', 'APP_EVENTS_CACHE' => 'events.php', 'APP_PACKAGES_CACHE' => 'packages.php', 'APP_ROUTES_CACHE' => 'routes-v7.php', 'APP_SERVICES_CACHE' => 'services.php'] as $key => $file) {
    $path = $cachePath.DIRECTORY_SEPARATOR.$file;
    $_ENV[$key] = $path;
    $_SERVER[$key] = $path;
    putenv($key.'='.$path);
}

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
    $app = require __DIR__.'/../bootstrap/app.php';
    if (empty(getenv('DB_CONNECTION')) || getenv('DB_CONNECTION') === 'sqlite') {
        try {
            $kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
            if (!\Illuminate\Support\Facades\Schema::hasTable('users')) {
                $kernel->call('migrate', ['--force' => true]);
                \App\Models\User::firstOrCreate(
                    ['email' => 'admin@nextlink.test'],
                    ['name' => 'System Administrator', 'password' => \Illuminate\Support\Facades\Hash::make('password123'), 'role' => 'admin']
                );
            }
        } catch (Throwable $e) {
            // Ignore init errors if schema check fails
        }
    }
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
