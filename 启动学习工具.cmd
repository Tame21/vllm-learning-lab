@echo off
chcp 65001 >nul
pushd "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 20 或更新版本。
  pause
  exit /b 1
)
echo 请在浏览器打开终端显示的地址，保持此窗口运行。
node scripts/start.mjs
if errorlevel 1 pause
popd
