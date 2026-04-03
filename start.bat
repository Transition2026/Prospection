@echo off
title Prospection B2B

echo === Prospection B2B ===
echo.

:: Verifier que Node.js est installe
node -v >nul 2>&1
if errorlevel 1 (
    echo ERREUR : Node.js n'est pas installe.
    echo Telechargez-le sur https://nodejs.org puis relancez ce fichier.
    pause
    exit /b 1
)

:: Installer les dependances backend
echo [1/4] Installation des dependances backend...
cd /d "%~dp0backend"
call npm install --silent
if errorlevel 1 (
    echo ERREUR lors de l'installation des dependances backend.
    pause
    exit /b 1
)

:: Installer les dependances frontend
echo [2/4] Installation des dependances frontend...
cd /d "%~dp0frontend"
call npm install --silent
if errorlevel 1 (
    echo ERREUR lors de l'installation des dependances frontend.
    pause
    exit /b 1
)

:: Builder le frontend
echo [3/4] Build du frontend...
call npm run build
if errorlevel 1 (
    echo ERREUR lors du build du frontend.
    pause
    exit /b 1
)

:: Ouvrir le navigateur apres 3 secondes (le temps que le serveur demarre)
start "" cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:3001"

:: Lancer le backend en production
echo [4/4] Demarrage du serveur...
echo L'application va s'ouvrir dans votre navigateur...
echo Fermez cette fenetre pour arreter l'application.
echo.
cd /d "%~dp0backend"
set NODE_ENV=production
node server.js

pause