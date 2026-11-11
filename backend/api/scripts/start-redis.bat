@echo off
REM ===================================================================
REM Start Redis for the NextLink platform.
REM
REM The Windows build is downloaded once into tools\redis and started from
REM there. When Redis is not available the API falls back to its in-process
REM queue, which is fine for development but loses the scheduled jobs on a
REM restart.
REM ===================================================================
setlocal

cd /d "%~dp0.."

set "REDIS_DIR=tools\redis"
set "REDIS_EXE=%REDIS_DIR%\redis-server.exe"
set "REDIS_URL=https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.zip"

if not exist "%REDIS_EXE%" (
  echo.
  echo  Redis is not installed yet. Downloading it...
  if not exist "%REDIS_DIR%" mkdir "%REDIS_DIR%"
  powershell -NoProfile -Command ^
    "Invoke-WebRequest -Uri '%REDIS_URL%' -OutFile '%TEMP%\redis-win.zip' -UseBasicParsing; Expand-Archive -Path '%TEMP%\redis-win.zip' -DestinationPath '%REDIS_DIR%' -Force"
  if not exist "%REDIS_EXE%" (
    echo  The download failed. The API will use its in-process queue.
    exit /b 1
  )
)

echo  Starting Redis on port 6379...
start "NextLink Redis" /min "%REDIS_EXE%" --port 6379 --save "" --appendonly no
timeout /t 3 /nobreak >nul

powershell -NoProfile -Command ^
  "$c = New-Object Net.Sockets.TcpClient('127.0.0.1',6379); try { $c.Connect(); Write-Host '  Redis is running.'; $c.Close() } catch { Write-Host '  Redis did not start.' }"

endlocal
