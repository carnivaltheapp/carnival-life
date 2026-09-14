$ErrorActionPreference = 'Stop'

$installDirectory = Join-Path $env:LOCALAPPDATA 'Carnival\DesktopWorkspace'
$resolvedLocalAppData = [IO.Path]::GetFullPath($env:LOCALAPPDATA).TrimEnd('\') + '\'
$resolvedInstallDirectory = [IO.Path]::GetFullPath($installDirectory).TrimEnd('\') + '\'
if (-not $resolvedInstallDirectory.StartsWith($resolvedLocalAppData, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to remove an unexpected path: $resolvedInstallDirectory"
}

Get-CimInstance Win32_Process -Filter "Name='CarnivalWorkspaceHost.exe'" |
  Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($resolvedInstallDirectory, [StringComparison]::OrdinalIgnoreCase) } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Remove-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'CarnivalDesktopWorkspace' -ErrorAction SilentlyContinue
Remove-Item -LiteralPath 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.carnival.workspace' -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath 'HKCU:\Software\Classes\Directory\shell\CarnivalAddBranch' -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath 'HKCU:\Software\Classes\Directory\shell\CarnivalRemoveBranch' -Recurse -Force -ErrorAction SilentlyContinue
if (Test-Path -LiteralPath $installDirectory) {
  Remove-Item -LiteralPath $installDirectory -Recurse -Force
}
Write-Host 'Carnival Desktop Workspace companion removed for the current user.'
