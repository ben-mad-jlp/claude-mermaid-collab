<#
.SYNOPSIS
  First-run WSL provisioning for the mermaid-collab Windows port (epic 68affdb7, P5).
  Brings a Windows machine to "ready to run the sidecar in WSL": enables the WSL
  platform, installs a distro on WSL2, and installs the in-WSL toolchain
  (tmux + git + bun). Idempotent — safe to re-run.

.DESCRIPTION
  Codifies the recipe validated 2026-06-15 (doc winport-wsl-validation-2026-06-15).
  The decision of record (588c6df1) requires WSL2. NOTE the known wall: on
  Apple-Silicon Parallels, Windows-ARM guests cannot run WSL2 (nested-virt not
  exposed → HCS_E_HYPERV_NOT_INSTALLED). On such a host this script will reach the
  v2 conversion and stop with a clear message; run it on a WSL2-capable machine.

.PARAMETER Distro
  The WSL distro to install (default: Ubuntu-24.04). See `wsl --list --online`.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\setup-wsl.ps1 -Distro Ubuntu-24.04
#>
param([string]$Distro = 'Ubuntu-24.04')

$ErrorActionPreference = 'Stop'
function Step($m) { Write-Host "[setup-wsl] $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "[setup-wsl] $m" -ForegroundColor Yellow }

# 1. Platform features (no-op if already enabled). VMP is what WSL2 needs.
Step 'ensuring Virtual Machine Platform + WSL features…'
$vmp = (Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform).State
$wslf = (Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux).State
if ($vmp -ne 'Enabled') { Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -NoRestart | Out-Null }
if ($wslf -ne 'Enabled') { Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -NoRestart | Out-Null }

# 2. WSL engine + kernel.
Step 'installing/updating the WSL engine…'
wsl.exe --install --no-distribution 2>&1 | Out-Host
wsl.exe --update 2>&1 | Out-Host
wsl.exe --set-default-version 2 2>&1 | Out-Host

# 3. Distro (skip if already registered).
$have = (wsl.exe -l -q) -replace "`0", '' | ForEach-Object { $_.Trim() }
if ($have -notcontains $Distro) {
  Step "installing distro $Distro (no launch)…"
  wsl.exe --install -d $Distro --no-launch 2>&1 | Out-Host
} else {
  Step "distro $Distro already registered."
}

# 4. Ensure it's WSL2 (the product path). On a nested-virt-blocked host this fails.
Step "ensuring $Distro is on WSL2…"
$conv = (wsl.exe --set-version $Distro 2 2>&1 | Out-String)
Write-Host $conv
if ($conv -match 'HCS_E_HYPERV_NOT_INSTALLED' -or $conv -match 'virtualization is not enabled') {
  Warn 'WSL2 cannot start on this machine (nested virtualization not available).'
  Warn 'If this is an Apple-Silicon Parallels VM, WSL2 for Windows-ARM is unsupported — use a WSL2-capable host.'
  Warn 'Stopping before toolchain install (the sidecar requires WSL2 fidelity).'
  exit 2
}

# 4b. Persistence (P4): disable WSL2 idle-shutdown so detached worker sessions
#     survive the fleet going quiet. Sets [wsl2] vmIdleTimeout=-1 in ~/.wslconfig,
#     preserving any existing settings. (Mirrors setVmIdleTimeout in wslconfig.ts.)
Step 'hardening persistence (.wslconfig vmIdleTimeout=-1)…'
$cfgPath = Join-Path $env:USERPROFILE '.wslconfig'
$cfg = if (Test-Path $cfgPath) { Get-Content -Raw $cfgPath } else { '' }
if ($cfg -match '(?ms)^\s*\[wsl2\]') {
  if ($cfg -match '(?m)^\s*vmIdleTimeout\s*=') {
    $cfg = [regex]::Replace($cfg, '(?m)^\s*vmIdleTimeout\s*=.*$', 'vmIdleTimeout=-1')
  } else {
    $cfg = [regex]::Replace($cfg, '(?m)^(\s*\[wsl2\]\s*)$', "`$1`nvmIdleTimeout=-1")
  }
} else {
  $cfg = ($cfg.TrimEnd() + "`n`n[wsl2]`nvmIdleTimeout=-1`n").TrimStart("`n")
}
Set-Content -Path $cfgPath -Value $cfg -Encoding ascii
wsl.exe --shutdown 2>&1 | Out-Null  # apply the new .wslconfig on next start

# 5. In-WSL toolchain: tmux + git + bun (run as root in the distro).
Step 'installing in-WSL toolchain (tmux, git, curl, bun)…'
$bootstrap = @'
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq tmux git curl unzip ca-certificates >/dev/null
if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1 || true
  ln -sf "$HOME/.bun/bin/bun" /usr/local/bin/bun 2>/dev/null || true
fi
echo "tmux: $(tmux -V 2>/dev/null || echo MISSING)"
echo "git:  $(git --version 2>/dev/null || echo MISSING)"
echo "bun:  $($HOME/.bun/bin/bun --version 2>/dev/null || bun --version 2>/dev/null || echo MISSING)"
'@
# Pipe the script via stdin so no quoting crosses the cmd/wsl boundary.
$bootstrap | wsl.exe -d $Distro -u root bash -l

Step 'done — WSL is provisioned. The sidecar can now run inside WSL.'
