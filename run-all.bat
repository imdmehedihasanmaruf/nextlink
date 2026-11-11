@echo off
REM ===================================================================
REM NextLink ISP - start all services
REM   1. Redis          (job queue, port 6379)
REM   2. Express API   (Backend Engine)  http://localhost:3001
REM   3. Frontend      (Client Portal)   http://localhost:3000
REM   4. Admin Panel   (Operations)      http://localhost:8000
REM ===================================================================
setlocal

cd /d "%~dp0"

echo.
echo  Starting NextLink ISP platform...
echo.

REM --- Redis ---------------------------------------------------------------
if not exist "api-server\tools\redis\redis-server.exe" (
  echo  [redis] downloading...
  call "api-server\scripts\start-redis.bat"
) else (
  echo  [redis] starting...
  start "NextLink Redis" /min "api-server\tools\redis\redis-server.exe" --port 6379 --save "" --appendonly no
  timeout /t 2 /nobreak >nul
)

REM --- Express API ----------------------------------------------------------
if not exist "api-server\node_modules" (
  echo  [api] installing dependencies...
  pushd api-server
  call npm install
  popd
)

echo  [api] applying database migrations...
pushd api-server
call node scripts\migrate.js >nul 2>&1
popd

start "NextLink API (Port 3001)" cmd /k "cd /d "%~dp0api-server" && npm run dev"
timeout /t 2 /nobreak >nul

start "NextLink Frontend (Port 3000)" cmd /k "cd /d "%~dp0frontend" && npm run dev"
start "NextLink Admin Panel (Port 8000)" cmd /k "cd /d "%~dp0backend" && npm run dev"

echo.
echo  ------------------------------------------------------------
echo   API          http://localhost:3001
echo   Frontend     http://localhost:3000
echo   Admin Panel  http://localhost:8000
echo   Redis        localhost:6379
echo.
echo   Admin logins:
echo     admin@nextlink.com   / admin123    (Super Admin)
echo     billing@nextlink.com / billing123  (Accounts)
echo     support@nextlink.com / support123  (Helpdesk)
echo     field@nextlink.com   / field123    (Field Technician)
echo  ------------------------------------------------------------
echo.
endlocal
