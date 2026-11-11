@echo off
setlocal
chcp 65001 >nul
rem ===================================================================
rem  NextLink Global — start everything
rem  1. Redis            (job queue, port 6379)
rem  2. Express API      (Backend Engine)  http://localhost:3000
rem  3. Frontend         (Client Portal)   http://localhost:3001 (web + /api proxy)
rem  4. Admin Panel      (Operations)      http://localhost:8000 (web + /api proxy)
rem
rem  Browsers never reach the Express port directly — /api/* is proxied
rem  to the API on 3000 by each Next.js app.
rem  Folders: ./frontend  ./backend     (nothing else lives at the repo root)
rem ===================================================================

set "ROOT=%~dp0"
set "FRONTEND=%ROOT%frontend"
set "BACKEND=%ROOT%backend"
set "API=%BACKEND%\api"
set "REDIS_EXE=%API%\tools\redis\redis-server.exe"

echo.
echo  Starting NextLink Global platform...
echo.

if not exist "%REDIS_EXE%" (
  echo  [redis] not found — starting the API without the queue
) else (
  echo  [redis] starting...
  start "NextLink Redis" /min "%REDIS_EXE%" --port 6379 --save "" --appendonly no
  timeout /t 2 /nobreak >nul
)

if not exist "%API%\node_modules" (
  echo  [api] installing dependencies...
  pushd "%API%"
  call npm install
  popd
)

echo  [api] applying database migrations...
pushd "%API%"
call node scripts\migrate.js >nul 2>&1
popd

start "NextLink API (Port 3000)" cmd /k "cd /d "%API%" && npm run dev"
timeout /t 2 /nobreak >nul

start "NextLink Frontend (Port 3001)" cmd /k "cd /d "%FRONTEND%" && npm run dev"
start "NextLink Admin (Port 8000)" cmd /k "cd /d "%BACKEND%" && npm run dev"

echo.
echo  ------------------------------------------------------------
echo   API          http://localhost:3000
echo   Frontend     http://localhost:3001
echo   Admin        http://localhost:8000
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
pause
