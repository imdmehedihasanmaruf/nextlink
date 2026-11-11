@echo off
REM Start only the NextLink Express API (Backend Engine) on port 3000
cd /d "%~dp0.."
if not exist "node_modules" call npm install
call node scripts\migrate.js
npm run dev
pause
