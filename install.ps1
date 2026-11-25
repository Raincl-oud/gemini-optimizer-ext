# Gemini Web Optimizer - 1-Command Windows Installer & Updater
# Usage: irm https://raw.githubusercontent.com/Raincl-oud/gemini-optimizer-ext/main/install.ps1 | iex
$ErrorActionPreference = 'Stop'

$RepoZipUrl = 'https://github.com/Raincl-oud/gemini-optimizer-ext/archive/refs/heads/main.zip'
$InstallDir = Join-Path $env:LOCALAPPDATA 'GeminiWebOptimizer'
$TempRoot   = Join-Path ([System.IO.Path]::GetTempPath()) ('gopt-install-' + [System.Guid]::NewGuid().ToString('N').Substring(0, 8))
$ZipPath    = Join-Path $TempRoot 'gemini-optimizer-ext.zip'
$ExtractDir = Join-Path $TempRoot 'extracted'

Write-Host ''
Write-Host '=== Gemini Web Optimizer Installer ===' -ForegroundColor Cyan
Write-Host "Target folder: $InstallDir"

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch { }

$isUpdate = Test-Path (Join-Path $InstallDir 'manifest.json')

try {
    New-Item -ItemType Directory -Path $TempRoot -Force | Out-Null
    Write-Host 'Downloading latest build from GitHub...' -ForegroundColor Gray
    Invoke-WebRequest -Uri $RepoZipUrl -OutFile $ZipPath -UseBasicParsing

    Write-Host 'Extracting files...' -ForegroundColor Gray
    Expand-Archive -Path $ZipPath -DestinationPath $ExtractDir -Force

    $sourceRoot = Get-ChildItem -Path $ExtractDir -Directory | Select-Object -First 1
    if (-not $sourceRoot -or -not (Test-Path (Join-Path $sourceRoot.FullName 'manifest.json'))) {
        throw 'Downloaded archive is missing manifest.json.'
    }

    $manifest = Get-Content (Join-Path $sourceRoot.FullName 'manifest.json') -Raw | ConvertFrom-Json
    $version = $manifest.version

    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    foreach ($item in @('manifest.json', 'icons', 'src')) {
        $srcPath = Join-Path $sourceRoot.FullName $item
        $dstPath = Join-Path $InstallDir $item
        if (Test-Path $dstPath) { Remove-Item -Path $dstPath -Recurse -Force }
        Copy-Item -Path $srcPath -Destination $dstPath -Recurse -Force
    }

    try { Set-Clipboard -Value $InstallDir } catch { }

    Write-Host ''
    if ($isUpdate) {
        Write-Host "Updated Gemini Web Optimizer to v$version!" -ForegroundColor Green
        Write-Host 'Next step: open your browser extensions page, click Reload on Gemini Web Optimizer, and refresh Gemini.' -ForegroundColor Yellow
    } else {
        Write-Host "Downloaded Gemini Web Optimizer v$version!" -ForegroundColor Green
        Write-Host "Folder path copied to clipboard: $InstallDir" -ForegroundColor Cyan
        Write-Host ''
        Write-Host 'Finish setup in your browser (takes ~10 seconds):' -ForegroundColor Yellow
        Write-Host '  1. Open chrome://extensions (or edge://extensions / opera://extensions)'
        Write-Host '  2. Turn on "Developer mode"'
        Write-Host '  3. Click "Load unpacked", press Ctrl+V, and select the folder'
        Write-Host '  4. Open or reload https://gemini.google.com/'
        Write-Host ''
        Write-Host 'Tip: Run this same command again anytime to update in-place.' -ForegroundColor Gray
    }
    Write-Host ''
} finally {
    if (Test-Path $TempRoot) {
        Remove-Item -Path $TempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
