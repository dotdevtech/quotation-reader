@echo off
REM Start Quotation Reader — backend + frontend together
cd /d "%~dp0"

set BACKEND=%~dp0web\backend
set FRONTEND=%~dp0web\frontend

if not exist "%BACKEND%\.env" (
  copy "%BACKEND%\.env.example" "%BACKEND%\.env"
  echo Created web\backend\.env — fill IMAP_USER, IMAP_PASSWORD, OPENAI_API_KEY then re-run.
  pause
  exit /b 1
)

if not exist "%BACKEND%\.venv\Scripts\python.exe" (
  echo Creating Python venv...
  cd /d "%BACKEND%"
  python -m venv .venv
  ".venv\Scripts\python.exe" -m pip install -U pip
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
)

if not exist "%FRONTEND%\node_modules" (
  echo Installing frontend packages...
  cd /d "%FRONTEND%"
  call npm install
)

echo Starting API  -  http://127.0.0.1:8000
start "Quotation API" /D "%BACKEND%" cmd /c ".venv\Scripts\python.exe run.py"

timeout /t 2 /nobreak >nul

echo Starting UI   -  http://127.0.0.1:5173
cd /d "%FRONTEND%"
echo.
echo Ready. Open:  http://127.0.0.1:5173
echo Close this window to stop the UI. Close the "Quotation API" window to stop the API.
echo.
call npm run dev -- --host 127.0.0.1 --port 5173
pause
