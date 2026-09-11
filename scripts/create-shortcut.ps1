$ErrorActionPreference = 'Stop'
try {
    $root = Split-Path -Parent $PSScriptRoot
    $target = Join-Path $PSScriptRoot 'start-project-os.cmd'
    if (-not (Test-Path $target)) { throw 'Launcher not found next to this script.' }
    $desktop = [Environment]::GetFolderPath('Desktop')
    $shortcutPath = Join-Path $desktop 'Project OS.lnk'
    if (Test-Path $shortcutPath) {
        $answer = Read-Host 'Project OS shortcut already exists. Replace it? Type YES'
        if ($answer -ne 'YES') { exit 0 }
    }
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $target
    $shortcut.WorkingDirectory = $root
    $shortcut.Description = 'Project OS - your local project workspace'
    $shortcut.WindowStyle = 1
    $shortcut.Save()
    Write-Host 'Project OS shortcut created on your desktop.'
    Write-Host 'After moving the project folder, run this script again to recreate the shortcut.'
} catch {
    Write-Host ('Could not create shortcut: ' + $_.Exception.Message)
    Write-Host 'Alternative: right-click start-project-os.cmd, then Send to > Desktop (create shortcut).'
}
Read-Host 'Press Enter to close'
