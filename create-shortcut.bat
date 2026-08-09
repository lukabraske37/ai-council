@echo off
cd /d "%~dp0"
title AI Council — Pravljenje precice

echo.
echo  Pravljenje precice za AI Council...
echo.

REM --- Proveri npm install ---
if not exist "node_modules" (
    echo  Instaliram zavisnosti, sacekaj malo...
    call npm install --silent
    if errorlevel 1 (
        echo  GRESKA: npm install nije uspeo. Da li je Node.js instaliran?
        echo  Preuzmi na: https://nodejs.org
        pause
        exit /b 1
    )
)

REM --- Putanje ---
set "APPDIR=%~dp0"
set "EXE=%~dp0node_modules\electron\dist\electron.exe"
set "DESKTOP=%USERPROFILE%\Desktop"
set "STARTMENU=%APPDATA%\Microsoft\Windows\Start Menu\Programs"

REM --- Proveri da li electron.exe postoji ---
if not exist "%EXE%" (
    echo  GRESKA: electron.exe nije pronadjen.
    echo  Probaj da pokrenes: npm install
    pause
    exit /b 1
)

REM --- Desktop precica (pokazuje na electron.exe direktno) ---
powershell -NoProfile -Command ^
  "$s = (New-Object -COM WScript.Shell).CreateShortcut('%DESKTOP%\AI Council.lnk');" ^
  "$s.TargetPath        = '%EXE%';" ^
  "$s.Arguments         = '.';" ^
  "$s.WorkingDirectory  = '%APPDIR%';" ^
  "$s.IconLocation      = '%EXE%,0';" ^
  "$s.Description       = 'AI Council';" ^
  "$s.WindowStyle       = 1;" ^
  "$s.Save()"

REM --- Start meni precica (ista stvar, potrebna za pin na taskbar) ---
powershell -NoProfile -Command ^
  "$s = (New-Object -COM WScript.Shell).CreateShortcut('%STARTMENU%\AI Council.lnk');" ^
  "$s.TargetPath        = '%EXE%';" ^
  "$s.Arguments         = '.';" ^
  "$s.WorkingDirectory  = '%APPDIR%';" ^
  "$s.IconLocation      = '%EXE%,0';" ^
  "$s.Description       = 'AI Council';" ^
  "$s.WindowStyle       = 1;" ^
  "$s.Save()"

echo.
echo  Gotovo!
echo.
echo  Kako da prikacis na taskbar (meni dole):
echo.
echo    1. Pokreni app (dupli klik na "AI Council" ikonicu na desktopu)
echo    2. Dok app radi, desni klik na ikonicu u taskbaru
echo    3. Izaberi "Prikaci na traku zadataka"
echo.
pause
