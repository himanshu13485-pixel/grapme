@echo off
setlocal
cd /d "%~dp0"

echo ==================================================
echo   AEO - starting full local dev stack
echo ==================================================
echo.

echo [1/2] Stopping anything already on the dev ports...
powershell -NoProfile -Command "foreach ($p in 3000,4000,5432,6379,2525) { $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue; if ($c) { taskkill /T /F /PID $c[0].OwningProcess > $null 2>&1 } }"

echo [2/2] Launching services (each in its own window)...

start "AEO DB (Postgres)"  cmd /k "npm run db:embedded"
start "AEO Redis"          /D "%~dp0.redis" cmd /k "redis-server.exe"
start "AEO SMTP sink"      cmd /k "npm run dev:smtp"

echo     ...waiting ~10s for the database to be ready...
timeout /t 10 /nobreak >nul

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
echo     Login:  admin@aeo.test  /  Password123!
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
