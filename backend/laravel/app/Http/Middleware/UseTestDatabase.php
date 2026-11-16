<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

class UseTestDatabase
{
    /**
     * Switch active database connection to `pgsql_test` (`nextlink_test_db`)
     * when `X-Use-Test-Db: nextlink_test_db` is sent in non-production environments.
     * Always attaches `X-Database-Target` header to the response.
     */
    public function handle(Request $request, Closure $next): Response
    {
        $isProduction = config('app.env') === 'production'
            || strtolower((string) $request->header('X-Simulate-Production', '')) === 'true';

        $requestedTestDb = trim((string) $request->header('X-Use-Test-Db', ''));

        if (!$isProduction && $requestedTestDb === 'nextlink_test_db') {
            $connections = config('database.connections', []);
            if (!isset($connections['pgsql_test']) && isset($connections['pgsql'])) {
                $testConn = $connections['pgsql'];
                $testConn['database'] = env('DB_TEST_DATABASE', 'nextlink_test_db');
                config(['database.connections.pgsql_test' => $testConn]);
            }
            config(['database.default' => 'pgsql_test']);
            DB::setDefaultConnection('pgsql_test');
        } else {
            config(['database.default' => 'pgsql']);
            DB::setDefaultConnection('pgsql');
        }

        /** @var Response $response */
        $response = $next($request);

        if (!$isProduction) {
            try {
                $dbName = DB::connection()->getDatabaseName();
            } catch (\Throwable $e) {
                $dbName = config('database.default') === 'pgsql_test' ? 'nextlink_test_db' : 'nextlink_db';
            }

            $response->headers->set('X-Database-Target', (string) $dbName);
        }

        return $response;
    }
}
