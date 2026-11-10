@echo off
REM Start only the NextLink Express API (Backend Engine) on port 3001
cd /d "%~dp0..\api-server"
if not exist "node_modules" call npm install
call node scripts\migrate.js
npm run dev
pause
