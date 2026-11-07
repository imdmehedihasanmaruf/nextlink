@echo off
echo Starting NextLink Frontend (User Portal) on Port 3000...
cd /d "%~dp0..\..\frontend"
npm run dev
pause
