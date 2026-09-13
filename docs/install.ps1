# Neo Quiz - one-command Obsidian plugin installer.
# Usage: irm https://ahmed-mili.github.io/neo-quiz/install.ps1 | iex
# Works on Windows PowerShell 5.1 and PowerShell 7+.
# Installs the plugin into an existing vault, or creates a brand new vault
# and installs into it, then opens Obsidian on that vault.

$ErrorActionPreference = "Stop"

$obsidianDir = Join-Path $env:APPDATA "obsidian"
if (-not (Test-Path $obsidianDir)) {
    Write-Host "Obsidian is not installed on this machine." -ForegroundColor Red
    Write-Host "Get it from https://obsidian.md/download" -ForegroundColor Red
    $answer = Read-Host "Install Obsidian now via winget? (y/N)"
    if ($answer -match "^[Yy]$") {
        winget install Obsidian.Obsidian
    }
    exit 1
}

$configPath = Join-Path $obsidianDir "obsidian.json"

function Get-ObsidianConfig {
    if (-not (Test-Path $configPath)) {
        return [PSCustomObject]@{ vaults = [PSCustomObject]@{} }
    }
    $raw = Get-Content -Raw -Path $configPath
    if ($raw.Trim().Length -eq 0) {
        return [PSCustomObject]@{ vaults = [PSCustomObject]@{} }
    }
    return $raw | ConvertFrom-Json
}

function Get-ObsidianVaults($config) {
    $result = @()
    if ($config.vaults) {
        foreach ($prop in $config.vaults.PSObject.Properties) {
            $vault = $prop.Value
            if ($vault.path -and (Test-Path $vault.path)) {
                $result += $vault.path
            }
        }
    }
    return $result
}

# Creates a brand new vault at $path: minimal .obsidian/ folder, community
# plugins enabled (see note below), and registers it in obsidian.json so it
# shows up in Obsidian's vault picker.
function New-ObsidianVault([string]$path, $config) {
    New-Item -ItemType Directory -Path $path -Force | Out-Null
    $obsidianSubDir = Join-Path $path ".obsidian"
    New-Item -ItemType Directory -Path $obsidianSubDir -Force | Out-Null

    # Restricted mode ("community plugins are off") in a brand new vault is
    # controlled purely by the ABSENCE of community-plugins.json -- there is
    # no separate flag in app.json. Creating the file (even as "[]") is what
    # "Turn off restricted mode" itself does; we go straight to listing our
    # plugin in it further down.

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)

    $vaultId = -join ((1..16) | ForEach-Object { "{0:x}" -f (Get-Random -Maximum 16) })
    $epochMs = [long]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())

    if (-not $config.vaults) {
        $config | Add-Member -NotePropertyName vaults -NotePropertyValue ([PSCustomObject]@{}) -Force
    }
    $config.vaults | Add-Member -NotePropertyName $vaultId -NotePropertyValue ([PSCustomObject]@{
        path = $path
        ts   = $epochMs
    }) -Force

    $json = $config | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText($configPath, $json, $utf8NoBom)

    Write-Host "New vault registered. If Obsidian is currently running, close it first: it may overwrite obsidian.json on exit." -ForegroundColor Yellow
}

$config = Get-ObsidianConfig
$vaults = Get-ObsidianVaults $config

Write-Host "Obsidian vaults:"
for ($i = 0; $i -lt $vaults.Count; $i++) {
    $name = Split-Path -Leaf $vaults[$i]
    Write-Host ("  [{0}] {1} ({2})" -f ($i + 1), $name, $vaults[$i])
}
if ($vaults.Count -gt 1) {
    Write-Host "  [A] All vaults"
}
Write-Host "  [N] Create a new vault"

$selected = @()
$newVaultPath = $null

if ($vaults.Count -eq 0) {
    $answer = "N"
} else {
    $answer = Read-Host "Install into which vault? (number, A, or N for a new vault)"
}

if ($answer -match "^[Nn]$") {
    $defaultPath = "C:\Neo Quiz"
    $input = Read-Host "Path for the new vault [$defaultPath]"
    $newVaultPath = if ($input.Trim().Length -gt 0) { $input.Trim() } else { $defaultPath }
    New-ObsidianVault -path $newVaultPath -config $config
    $selected = @($newVaultPath)
} elseif ($answer -match "^[Aa]$" -and $vaults.Count -gt 1) {
    $selected = $vaults
} else {
    $index = [int]$answer - 1
    if ($index -lt 0 -or $index -ge $vaults.Count) {
        Write-Host "Invalid choice." -ForegroundColor Red
        exit 1
    }
    $selected = @($vaults[$index])
}

$baseUrl = "https://github.com/ahmed-mili/neo-quiz/releases/latest/download"
$files = @("main.js", "manifest.json", "styles.css")

foreach ($vaultPath in $selected) {
    Write-Host ""
    Write-Host ("Installing into: {0}" -f $vaultPath)

    $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("neo-quiz-install-" + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

    try {
        foreach ($file in $files) {
            $url = "$baseUrl/$file"
            $dest = Join-Path $tempDir $file
            Write-Host ("  Downloading $file...")
            Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
        }

        $pluginDir = Join-Path $vaultPath ".obsidian\plugins\quiz-blocks"
        if (-not (Test-Path $pluginDir)) {
            New-Item -ItemType Directory -Path $pluginDir -Force | Out-Null
        }
        foreach ($file in $files) {
            Copy-Item -Path (Join-Path $tempDir $file) -Destination (Join-Path $pluginDir $file) -Force
        }
    } finally {
        Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    # Enable the plugin in community-plugins.json (create it if the vault
    # never had community plugins turned on before).
    $communityPluginsPath = Join-Path $vaultPath ".obsidian\community-plugins.json"
    $plugins = @()
    if (Test-Path $communityPluginsPath) {
        $content = Get-Content -Raw -Path $communityPluginsPath
        if ($content.Trim().Length -gt 0) {
            $plugins = @(ConvertFrom-Json $content)
        }
    }
    if ($plugins -notcontains "quiz-blocks") {
        $plugins += "quiz-blocks"
    }
    $json = ConvertTo-Json $plugins
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($communityPluginsPath, $json, $utf8NoBom)

    $manifestPath = Join-Path $pluginDir "manifest.json"
    $version = (Get-Content -Raw -Path $manifestPath | ConvertFrom-Json).version
    Write-Host ("  Installed Neo Quiz v$version") -ForegroundColor Green
}

Write-Host ""
Write-Host "Reload plugins if the vault was already open." -ForegroundColor Green

foreach ($vaultPath in $selected) {
    $vaultName = Split-Path -Leaf $vaultPath
    $uri = "obsidian://open?vault=" + [uri]::EscapeDataString($vaultName)
    Start-Process $uri
}
