@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 余烬深渊 - 本地服务器

if not exist "node_modules" (
  echo 正在安装项目依赖...
  call npm install
  if errorlevel 1 (
    echo 依赖安装失败，请检查 Node.js 和网络连接。
    pause
    exit /b 1
  )
)

powershell.exe -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if not errorlevel 1 (
  start "" "http://127.0.0.1:5173/"
  exit /b 0
)

start "" powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:5173/'"
echo.
echo 余烬深渊正在运行：http://127.0.0.1:5173/
echo 关闭此窗口即可停止游戏服务器。
echo.
npm run dev -- --port 5173 --strictPort
