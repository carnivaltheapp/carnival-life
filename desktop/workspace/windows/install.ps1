param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-p]{32}$')]
  [string]$ExtensionId
)

$ErrorActionPreference = 'Stop'
$hostName = 'com.carnival.workspace'
$hostMarker = 'DRAWER-HOST-3'
$source = Join-Path $PSScriptRoot 'CarnivalWorkspaceHost.cs'
$installDirectory = Join-Path $env:LOCALAPPDATA 'Carnival\DesktopWorkspace'
$hostExecutable = Join-Path $installDirectory 'CarnivalWorkspaceHost.exe'
$temporaryExecutable = Join-Path $installDirectory 'CarnivalWorkspaceHost.new.exe'
$manifestPath = Join-Path $installDirectory "$hostName.json"
$registryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"

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

if (Test-Path -LiteralPath $registryPath) {
  Remove-Item -LiteralPath $registryPath -Recurse -Force
}
$stopDeadline = [DateTime]::UtcNow.AddSeconds(10)
do {
  $hostProcesses = @(
    Get-CimInstance Win32_Process -Filter "Name='CarnivalWorkspaceHost.exe'" |
      Where-Object { $_.ExecutablePath -eq $hostExecutable }
  )
  foreach ($hostProcess in $hostProcesses) {
    Stop-Process -Id $hostProcess.ProcessId -Force -ErrorAction SilentlyContinue
  }
  if ($hostProcesses.Count -gt 0) { Start-Sleep -Milliseconds 100 }
} while ($hostProcesses.Count -gt 0 -and [DateTime]::UtcNow -lt $stopDeadline)
if ($hostProcesses.Count -gt 0) {
  throw "Carnival native host processes did not stop before the upgrade deadline."
}
for ($attempt = 1; $attempt -le 20; $attempt += 1) {
  try {
    if (Test-Path -LiteralPath $hostExecutable) {
      Remove-Item -LiteralPath $hostExecutable -Force
    }
    Move-Item -LiteralPath $temporaryExecutable -Destination $hostExecutable
    break
  } catch {
    if ($attempt -eq 20) { throw }
    Start-Sleep -Milliseconds 100
  }
}

$manifest = [ordered]@{
  name = $hostName
  description = 'Carnival hot-corner desktop companion'
  path = $hostExecutable
  type = 'stdio'
  allowed_origins = @("chrome-extension://$ExtensionId/")
}
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 3), $utf8WithoutBom)

New-Item -Force -Path $registryPath | Out-Null
Set-Item -LiteralPath $registryPath -Value $manifestPath

$startupRegistryPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$startupName = 'CarnivalDesktopWorkspace'
$startupCommand = '"{0}" --resident' -f $hostExecutable
Set-ItemProperty -LiteralPath $startupRegistryPath -Name $startupName -Value $startupCommand
Start-Process -FilePath $hostExecutable -ArgumentList '--resident' -WindowStyle Hidden
Start-Sleep -Milliseconds 500
$residentProcesses = @(
  Get-CimInstance Win32_Process -Filter "Name='CarnivalWorkspaceHost.exe'" |
    Where-Object {
      $_.ExecutablePath -eq $hostExecutable -and $_.CommandLine -match '(?:^|\s)--resident(?:\s|$)'
    }
)
if ($residentProcesses.Count -ne 1) {
  throw "Expected exactly one Carnival resident process; found $($residentProcesses.Count)."
}

Write-Host "Installed $hostName for Chrome extension $ExtensionId."
Write-Host "Installed binary: $hostExecutable"
Write-Host "Native host marker: $hostMarker"
Write-Host "Current-user auto-start: $startupCommand"
Write-Host "Resident PID: $($residentProcesses[0].ProcessId)"
Write-Host 'Restart Chrome to activate the companion.'
