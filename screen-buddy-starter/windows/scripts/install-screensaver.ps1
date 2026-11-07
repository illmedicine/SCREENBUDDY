<#
.SYNOPSIS
  Publishes Screen Buddy and registers it as your Windows screensaver (current user only, no admin needed).
.DESCRIPTION
  Builds a self-contained copy into %LOCALAPPDATA%\ScreenBuddy\app, copies ScreenBuddy.exe to ScreenBuddy.scr beside it,
  and points HKCU\Control Panel\Desktop\SCRNSAVE.EXE at it. Run with -Uninstall to remove the screensaver setting.
  Nothing is written outside your user profile.
#>
param([switch]$Uninstall)

$ErrorActionPreference = 'Stop'
$install = Join-Path $env:LOCALAPPDATA 'ScreenBuddy\app'
$desktop = 'HKCU:\Control Panel\Desktop'

if ($Uninstall) {
    Remove-ItemProperty -Path $desktop -Name SCRNSAVE.EXE -ErrorAction SilentlyContinue
    Set-ItemProperty -Path $desktop -Name ScreenSaveActive -Value '0'
    if (Test-Path $install) { Remove-Item $install -Recurse -Force }
    Write-Host 'Screen Buddy screensaver removed.'
    return
}

$project = Join-Path $PSScriptRoot '..\src\ScreenBuddy.App\ScreenBuddy.App.csproj'
dotnet publish $project -c Release -r win-x64 --self-contained true -o $install
if ($LASTEXITCODE -ne 0) { throw 'dotnet publish failed' }

Copy-Item (Join-Path $install 'ScreenBuddy.exe') (Join-Path $install 'ScreenBuddy.scr') -Force
Set-ItemProperty -Path $desktop -Name SCRNSAVE.EXE -Value (Join-Path $install 'ScreenBuddy.scr')
Set-ItemProperty -Path $desktop -Name ScreenSaveActive -Value '1'
Write-Host "Installed to $install. Open Settings > Personalization > Lock screen > Screen saver to set the wait time or preview it."
