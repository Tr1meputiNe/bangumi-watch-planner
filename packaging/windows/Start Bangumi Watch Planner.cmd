@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -NonInteractive -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3777/api/auth/status' -TimeoutSec 2; if ($r.Headers['X-BWP-App'] -eq 'bangumi-watch-planner') { exit 0 }; exit 2 } catch { if ($_.Exception.Response) { exit 2 }; exit 1 }"
if errorlevel 2 goto portConflict
if errorlevel 1 start "Bangumi Watch Planner" /min "%~dp0Bangumi-Watch-Planner.exe"
for /L %%i in (1,1,30) do (
  powershell.exe -NoProfile -NonInteractive -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3777/api/auth/status' -TimeoutSec 2; if ($r.Headers['X-BWP-App'] -eq 'bangumi-watch-planner') { exit 0 }; exit 2 } catch { if ($_.Exception.Response) { exit 2 }; exit 1 }"
  if errorlevel 2 goto portConflict
  if not errorlevel 1 goto open
  timeout /t 1 /nobreak >nul
)
echo The service did not start. Keep this window open and review the error above.
pause
exit /b 1

:open
start "" "http://127.0.0.1:3777/"
exit /b 0

:portConflict
echo Port 3777 is used by another application. Close it before starting Bangumi Watch Planner.
pause
exit /b 1
