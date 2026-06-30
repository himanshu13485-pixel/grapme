@echo off
setlocal
cd /d "%~dp0"
echo Stopping AEO dev stack (DB, Redis, SMTP sink, API, Web)...
powershell -NoProfile -Command "foreach ($p in 3000,4000,5432,6379,2525) { $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue; if ($c) { taskkill /T /F /PID $c[0].OwningProcess > $null 2>&1; Write-Host ('  stopped port ' + $p) } else { Write-Host ('  port ' + $p + ' already free') } }"

rem Also clear any orphaned Postgres that the port-owner kill missed (zombie
rem listeners), plus a stale lock, so the next start-dev is always clean.
taskkill /F /IM postgres.exe >nul 2>&1 && echo   cleared stray postgres.exe
if exist "%~dp0apps\api\.pgdata\postmaster.pid" ( del /f /q "%~dp0apps\api\.pgdata\postmaster.pid" >nul 2>&1 & echo   removed stale postmaster.pid )

echo Done. (Service windows may need to be closed manually.)
echo.
pause
