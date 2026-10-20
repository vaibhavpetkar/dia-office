@echo off
REM One-time setup for Windows: double-click this file, or run setup.bat
cd /d "%~dp0"
py -m venv .venv || python -m venv .venv
.venv\Scripts\python -m pip install --upgrade pip -q
.venv\Scripts\pip install -r requirements.txt
if not exist .env copy .env.example .env
.venv\Scripts\python selftest.py
echo.
echo Setup done. Every time you open a new terminal, run:  .venv\Scripts\activate
pause
