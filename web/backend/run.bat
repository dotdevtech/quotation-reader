@echo off
cd /d "%~dp0"
if not exist ".env" copy .env.example .env
if not exist ".venv\Scripts\python.exe" (
  python -m venv .venv
  ".venv\Scripts\python.exe" -m pip install -U pip
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
)
if not exist data mkdir data
if not exist exports mkdir exports
".venv\Scripts\python.exe" run.py
pause
