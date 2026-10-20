@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" (
  echo 처음 실행입니다. 필요한 패키지를 설치합니다...
  call npm install
  if errorlevel 1 (
    echo.
    echo 설치에 실패했습니다. Node.js가 설치되어 있는지 확인하세요.
    pause
    exit /b 1
  )
)

start "" "node_modules\electron\dist\electron.exe" .
