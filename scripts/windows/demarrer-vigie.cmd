@echo off
rem Lance Vigie sur ce PC (interface sur http://localhost:4700).
cd /d "%~dp0\..\.."
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js est introuvable. Installez-le depuis https://nodejs.org puis relancez ce fichier.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installation des dependances...
  call npm install --no-audit --no-fund
)
node server\local.js %*
