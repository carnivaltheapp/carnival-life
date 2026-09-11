param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-p]{32}$')]
  [string]$ExtensionId
)

$ErrorActionPreference = 'Stop'
$hostName = 'com.carnival.workspace'
$hostMarker = 'DRAWER-HOST-2'
$source = Join-Path $PSScriptRoot 'CarnivalWorkspaceHost.cs'
$installDirectory = Join-Path $env:LOCALAPPDATA 'Carnival\DesktopWorkspace'
$hostExecutable = Join-Path $installDirectory 'CarnivalWorkspaceHost.exe'
$temporaryExecutable = Join-Path $installDirectory 'CarnivalWorkspaceHost.new.exe'
$manifestPath = Join-Path $installDirectory "$hostName.json"

New-Item -ItemType Directory -Force -Path $installDirectory | Out-Null
if (Test-Path -LiteralPath $temporaryExecutable) {
  Remove-Item -LiteralPath $temporaryExecutable -Force
}
$compiler = @(
  "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
  "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $compiler) {
  throw 'The Windows .NET Framework C# compiler is required.'
}
& $compiler /nologo /target:exe "/out:$temporaryExecutable" $source
if ($LASTEXITCODE -ne 0) {
  throw 'Carnival native host compilation failed.'
}

Get-Process -Name 'CarnivalWorkspaceHost' -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -eq $hostExecutable } |
  ForEach-Object {
    Stop-Process -Id $_.Id -Force
    Wait-Process -Id $_.Id -Timeout 5 -ErrorAction SilentlyContinue
  }
if (Test-Path -LiteralPath $hostExecutable) {
  Remove-Item -LiteralPath $hostExecutable -Force
}
Move-Item -LiteralPath $temporaryExecutable -Destination $hostExecutable

$manifest = [ordered]@{
  name = $hostName
  description = 'Carnival hot-corner desktop companion'
  path = $hostExecutable
  type = 'stdio'
  allowed_origins = @("chrome-extension://$ExtensionId/")
}
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 3), $utf8WithoutBom)

$registryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"
New-Item -Force -Path $registryPath | Out-Null
Set-Item -LiteralPath $registryPath -Value $manifestPath

Write-Host "Installed $hostName for Chrome extension $ExtensionId."
Write-Host "Installed binary: $hostExecutable"
Write-Host "Native host marker: $hostMarker"
Write-Host 'Restart Chrome to activate the companion.'
