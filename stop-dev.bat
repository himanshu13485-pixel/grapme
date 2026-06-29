@echo off
echo Stopping AEO dev stack (DB, Redis, SMTP sink, API, Web)...
powershell -NoProfile -Command "foreach ($p in 3000,4000,5432,6379,2525) { $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue; if ($c) { taskkill /T /F /PID $c[0].OwningProcess > $null 2>&1; Write-Host ('  stopped port ' + $p) } else { Write-Host ('  port ' + $p + ' already free') } }"
echo Done. (Service windows may need to be closed manually.)
echo.
pause
