@echo off
REM BTC Rebalancing Bot - Simple wrapper script
REM This wrapper allows Task Scheduler to run the bot reliably

setlocal enabledelayedexpansion

REM Change to bot directory
cd /d "%~dp0"

REM Log file path
set LOGFILE=%~dp0bot_output.log

REM Full path to Node.js
set NODE_PATH=C:\nvm4w\nodejs\node.exe

REM Full path to npx (npm package runner)
set NPX_PATH=C:\nvm4w\nodejs\npx.cmd

REM Verify node exists
if not exist "%NODE_PATH%" (
    echo. >> "%LOGFILE%"
    echo ========================================== >> "%LOGFILE%"
    echo ERROR: Node.js not found at %NODE_PATH% >> "%LOGFILE%"
    echo Please install Node.js or update NODE_PATH in run-bot.bat >> "%LOGFILE%"
    echo ========================================== >> "%LOGFILE%"
    exit /b 1
)

REM Verify npx exists
if not exist "%NPX_PATH%" (
    echo. >> "%LOGFILE%"
    echo ========================================== >> "%LOGFILE%"
    echo ERROR: npx not found at %NPX_PATH% >> "%LOGFILE%"
    echo Please verify npm is installed >> "%LOGFILE%"
    echo ========================================== >> "%LOGFILE%"
    exit /b 1
)

REM Log file path
echo. >> "%LOGFILE%"
echo ========================================== >> "%LOGFILE%"
echo Run started at: %date% %time% >> "%LOGFILE%"
echo ========================================== >> "%LOGFILE%"

REM Execute the bot using Node.js directly (no TypeScript compilation needed)
call "%NODE_PATH%" bot.js >> "%LOGFILE%" 2>&1

REM Log completion
echo Run completed at: %date% %time% >> "%LOGFILE%"
echo ========================================== >> "%LOGFILE%"

exit /b 0

