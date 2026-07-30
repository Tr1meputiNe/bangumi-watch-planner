@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -NonInteractive -Command "try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3777/api/auth/status' -TimeoutSec 1 | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 start "Bangumi Watch Planner" /min "%~dp0Bangumi-Watch-Planner.exe"
for /L %%i in (1,1,30) do (
  powershell.exe -NoProfile -NonInteractive -Command "try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3777/api/auth/status' -TimeoutSec 1 | Out-Null; exit 0 } catch { exit 1 }"
  if not errorlevel 1 goto open
  timeout /t 1 /nobreak >nul
)
echo The service did not start. Keep this window open and review the error above.
pause
exit /b 1

:open
start "" "http://127.0.0.1:3777/"
