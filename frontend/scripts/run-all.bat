@echo off
echo Starting NextLink ISP System...
start "NextLink Frontend (Port 3000)" cmd /k "cd /d "%~dp0..\..\frontend" && npm run dev"
start "NextLink Backend Panel (Port 8000)" cmd /k "cd /d "%~dp0.." && npm run dev"
echo Both Frontend (http://localhost:3000) and Backend Panel (http://localhost:8000) are starting!
