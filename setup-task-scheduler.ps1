# BTC Rebalancing Bot - Task Scheduler Setup
# Run this PowerShell script as Administrator to schedule the bot

# Configuration
$botPath = "C:\Users\rickh\Documents\programming\linear_bot"
$taskName = "BTC_Rebalancing_Bot"
$logFile = "$botPath\bot_output.log"

Write-Host "Setting up Task Scheduler for BTC Rebalancing Bot..."
Write-Host "Bot Path: $botPath"
Write-Host "Task Name: $taskName"
Write-Host "Log File: $logFile"
Write-Host ""

# Check if already exists and remove it
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existingTask) {
    Write-Host "Removing existing task '$taskName'..."
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Start-Sleep -Milliseconds 500
}

# Create the action - simply call run-bot.bat
$action = New-ScheduledTaskAction `
    -Execute "$botPath\run-bot.bat" `
    -WorkingDirectory $botPath

# Create the principal - run as SYSTEM
$principal = New-ScheduledTaskPrincipal `
    -UserId "SYSTEM" `
    -LogonType ServiceAccount `
    -RunLevel Highest

# Create trigger: start in 2 minutes, repeat every 1 hour indefinitely
$now = Get-Date
$startTime = $now.AddMinutes(2)

Write-Host "First run scheduled for: $($startTime.ToString('yyyy-MM-dd HH:mm:ss'))"

$trigger = New-ScheduledTaskTrigger `
    -Once `
    -At $startTime `
    -RepetitionInterval (New-TimeSpan -Hours 12)

# Settings for reliability
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable

# Register the task
try {
    Register-ScheduledTask `
        -TaskName $taskName `
        -Trigger $trigger `
        -Action $action `
        -Principal $principal `
        -Settings $settings `
        -Description "Automatically rebalances BTC/USDC portfolio on Kraken" `
        -Force | Out-Null
    
    Write-Host ""
    Write-Host "✅ Task '$taskName' registered successfully!"
    Write-Host ""
    Write-Host "Schedule:"
    Write-Host "  - First run: $($startTime.ToString('yyyy-MM-dd HH:mm:ss'))"
    Write-Host "  - Frequency: Every 1 hour"
    Write-Host "  - Continues: After reboots"
    Write-Host "  - User: SYSTEM (runs even if you're logged out)"
    Write-Host ""
    Write-Host "To verify:"
    Write-Host "  1. Open Task Scheduler"
    Write-Host "  2. Find 'BTC_Rebalancing_Bot' in Library"
    Write-Host "  3. Right-click → Properties to confirm settings"
    Write-Host "  4. Right-click → Run to test manually"
    Write-Host ""
    Write-Host "Output: Check $logFile after first run"
    Write-Host ""
    
} catch {
    Write-Host "❌ Error creating task: $_"
    exit 1
}
