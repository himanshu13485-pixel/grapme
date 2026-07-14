@echo off
setlocal
cd /d "%~dp0"

echo ==================================================
echo   AEO - starting full local dev stack
echo ==================================================
echo.

echo [1/2] Stopping anything already on the dev ports...
powershell -NoProfile -Command "foreach ($p in 3000,4000,5432,6379,2525) { $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue; if ($c) { taskkill /T /F /PID $c[0].OwningProcess > $null 2>&1 } }"

echo     ...clearing any stray Postgres + stale lock (self-heal a crashed DB)...
rem A previous embedded Postgres that exited uncleanly can leave an orphaned
rem postgres.exe holding port 5432, plus a stale postmaster.pid that blocks
rem startup. The port-owner kill above misses zombie listeners, so also clear
rem Postgres by image name (this box has no system Postgres service).
taskkill /F /IM postgres.exe >nul 2>&1
if exist "%~dp0apps\api\.pgdata\postmaster.pid" del /f /q "%~dp0apps\api\.pgdata\postmaster.pid" >nul 2>&1
rem Give the OS a moment to release the socket before we rebind it.
timeout /t 2 /nobreak >nul

echo [2/2] Launching services (each in its own window)...

start "AEO DB (Postgres)"  cmd /k "npm run db:embedded"
start "AEO Redis"          /D "%~dp0.redis" cmd /k "redis-server.exe"
start "AEO SMTP sink"      cmd /k "npm run dev:smtp"

echo     ...waiting ~10s for the database to be ready...
timeout /t 10 /nobreak >nul

echo     ...applying any pending database migrations...
pushd apps\api
call npx prisma migrate deploy
popd

rem QUEUE_ENABLED=true turns on the sending engine (needs Redis, started above).
start "AEO API"            cmd /k "set QUEUE_ENABLED=true&& set DISPATCH_SCAN_MS=10000&& npm run dev:api"

echo     ...waiting ~8s for the API...
timeout /t 8 /nobreak >nul

start "AEO Web"            cmd /k "npm run dev:web"

echo.
echo ==================================================
echo   All services launching. Give them ~20-30s, then:
echo.
echo     Web:    http://localhost:3000
echo     Login:  admin@grapme.local  /  Password123!
echo     API:    http://localhost:4000/api/v1
echo.
echo   SMTP sink catches test emails - point a test mailbox at:
echo     host 127.0.0.1   port 2525   TLS off
echo ==================================================
echo.
echo Each service runs in its OWN window. Closing THIS window is fine.
echo To stop everything later, run  stop-dev.bat
echo.
pause
