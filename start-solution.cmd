@echo off
rem Starts the QuickCart dashboards at /solution on the bundled dummy data (no backend needed).
rem   Double-click to start.  Run "start-solution.cmd rebuild" after changing any code.
setlocal
cd /d "%~dp0frontend"

rem Skip the login screen, which needs the backend, for the rest of the app too.
set QUICKCART_PUBLIC_DEMO=1
set NEXT_PUBLIC_PUBLIC_DEMO=1

if /i "%~1"=="rebuild" goto build
if not exist ".next\BUILD_ID" goto build
goto run

:build
echo Building QuickCart (takes 2-3 minutes)...
call npm run build
if errorlevel 1 (
  echo Build failed. See the messages above.
  pause
  exit /b 1
)

:run
echo.
echo QuickCart is starting at http://localhost:3000/solution
echo Keep this window open during the presentation. Close it to stop QuickCart.
echo.
start "" cmd /c "timeout /t 5 /nobreak >nul & start "" http://localhost:3000/solution"
call npm run start
pause
