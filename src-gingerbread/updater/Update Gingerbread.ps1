<#
  Reward Routine Automator — Gingerbread: the one-click updater.

  Why this exists: Gingerbread ships as a zip on a GitHub Release, and updating
  it by hand means finding the newest release, downloading the asset, working
  out which folder Chrome is actually loading, copying over it, and clicking
  Reload in chrome://extensions. This collapses that into one double-click.

  Why it sits INSIDE the extension folder: it targets its own parent directory
  by default. The folder Chrome loads unpacked IS the folder this was unzipped
  into, so there is nothing to configure and no first-run folder picker — that
  zero setup is what makes it one click instead of three.

  Why a reload click still remains: this script writes files to disk, but
  Chrome holds the extension in memory and never re-reads that folder on its
  own. No API lets an extension — or a script outside it — press Reload. So the
  popup gains a Restart control that appears only when it notices the folder's
  manifest.json version no longer matches the version Chrome has loaded.

  Unpacked extensions cannot auto-update at all: Chrome's self-hosted
  update_url/updates.xml path is [BLOCKED] on Windows for any machine that is
  not enterprise-managed. See docs/architecture/adr-024-one-click-updater.md.

  Unauthenticated against the GitHub API — 60 requests/hour is ample for this.
#>
[CmdletBinding()]
param(
  # The extension folder to update. Defaults to this script's parent, which is
  # the extension root in the shipped zip's layout (updater/ beside manifest.json).
  [string]$Target = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'

# Windows PowerShell 5.1 negotiates TLS 1.0 on older builds and GitHub refuses
# it, and the GitHub API requires a User-Agent. Both failures are silent enough
# to be worth pinning here rather than debugging later.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$UserAgent = 'RewardRoutineAutomator-Gingerbread-Updater'

$Repo = 'entropy63/reward-routine-automator'
$AssetPattern = '*Gingerbread*.zip'

# The one folder the sync never writes to and never deletes from. The running
# .cmd is held open by cmd.exe while it executes, so copying over it fails; the
# whole folder is excluded instead of just that file, which keeps the rule
# simple to state. The updater therefore does not update itself — if it ever
# changes, the release notes say so and this one file is re-downloaded by hand.
$KeepDir = 'updater'

function Write-Step($text) { Write-Host "  $text" }

# Read and identify the build, not just a version-shaped field: a mislabeled
# release asset must never install another variant over Gingerbread.
function Get-ManifestVersion([string]$Dir) {
  $path = Join-Path $Dir 'manifest.json'
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  try {
    $manifest = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
    $expectedName = 'Reward Routine Automator ' + [char]0x2014 + ' Gingerbread'
    if ($manifest.manifest_version -ne 3 -or $manifest.name -cne $expectedName) { return $null }
    if ($manifest.version -isnot [string] -or $manifest.version -notmatch '^\d+(\.\d+){0,3}$') { return $null }
    $parts = @($manifest.version.Split('.'))
    if (@($parts | Where-Object { $_.Length -gt 5 -or [int]$_ -gt 65535 }).Count) { return $null }
    while ($parts.Count -lt 4) { $parts += '0' }
    if ([version]($parts -join '.') -eq [version]'0.0.0.0') { return $null }
    return $manifest.version
  } catch {
    return $null
  }
}

function Get-ComparableVersion([string]$Version) {
  $parts = @($Version.Split('.'))
  while ($parts.Count -lt 4) { $parts += '0' }
  return [version]($parts -join '.')
}

# A junction/symlink inside either tree could redirect a copy or removal outside
# the chosen extension folder. Refuse it before the sync touches any files.
function Assert-RegularTree([string]$Root) {
  $entries = @((Get-Item -LiteralPath $Root -Force)) + @(Get-ChildItem -LiteralPath $Root -Recurse -Force)
  if (@($entries | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) {
    throw "Linked folders or files are not supported: $Root"
  }
}

# Every file under $Root as a set of relative paths — the two halves of the
# sync diff (what to copy, what to delete) are both "is this path in here".
function Get-RelativeFileSet([string]$Root) {
  $set = @{}
  Get-ChildItem -LiteralPath $Root -Recurse -File -Force | ForEach-Object {
    $set[$_.FullName.Substring($Root.Length).TrimStart('\')] = $true
  }
  return $set
}

function Test-Kept([string]$Relative) {
  return $Relative -eq $KeepDir -or $Relative.StartsWith("$KeepDir\", [StringComparison]::OrdinalIgnoreCase)
}

Write-Host ''
Write-Host 'Reward Routine Automator — Gingerbread updater' -ForegroundColor Cyan
Write-Host ''

if (-not (Test-Path -LiteralPath $Target -PathType Container)) {
  Write-Host "Not a folder: $Target" -ForegroundColor Red
  exit 1
}
$Target = (Resolve-Path -LiteralPath $Target).Path.TrimEnd('\')

$current = Get-ManifestVersion $Target
if (-not $current) {
  Write-Host "No valid Gingerbread Manifest V3 extension in $Target." -ForegroundColor Red
  Write-Host 'Point this at the folder you load unpacked.' -ForegroundColor Red
  exit 1
}
Write-Step "Installed: $current"

# --- Find the newest Gingerbread release -----------------------------------
# /releases/latest is the newest release of ANY build, so a future Cupcake or
# Froyo release would break it. Walking the list and taking the first release
# that actually carries a Gingerbread zip is the version that keeps working.
Write-Step 'Checking GitHub for the newest release...'
try {
  # @() so a single-release answer is still a list to walk, not a bare object.
  $releases = @(Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases?per_page=20" -UserAgent $UserAgent -Headers @{ Accept = 'application/vnd.github+json' })
} catch {
  Write-Host "Could not reach GitHub: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

$asset = $null
$release = $null
foreach ($r in $releases) {
  if ($r.draft -or $r.prerelease) { continue }
  $match = $r.assets | Where-Object { $_.name -like $AssetPattern } | Select-Object -First 1
  if ($match) { $release = $r; $asset = $match; break }
}
if (-not $asset) {
  Write-Host "No Gingerbread zip found in the last $($releases.Count) releases." -ForegroundColor Red
  exit 1
}
Write-Step "Newest:    $($release.tag_name)  ($($asset.name))"

# --- Download and stage ----------------------------------------------------
$work = Join-Path $env:TEMP ('gb-update-' + [Guid]::NewGuid().ToString('N'))
$zipPath = Join-Path $work 'release.zip'
$stageDir = Join-Path $work 'stage'
New-Item -ItemType Directory -Path $work -Force | Out-Null

try {
  Write-Step 'Downloading...'
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath -UserAgent $UserAgent -UseBasicParsing

  Write-Step 'Extracting...'
  Expand-Archive -LiteralPath $zipPath -DestinationPath $stageDir -Force

  # Check the staged folder is actually an extension BEFORE anything in the
  # target is touched — a truncated download or a wrongly-shaped asset must not
  # get as far as modifying a working install.
  $staged = Get-ManifestVersion $stageDir
  if (-not $staged) {
    Write-Host 'The downloaded zip has no valid Gingerbread manifest at its root — refusing to touch your install.' -ForegroundColor Red
    exit 1
  }
  Write-Step "Available: $staged"

  if ((Get-ComparableVersion $staged) -le (Get-ComparableVersion $current)) {
    Write-Host ''
    Write-Host "Already up to date ($current); available $staged is not newer." -ForegroundColor Green
    exit 0
  }

  Assert-RegularTree $stageDir
  Assert-RegularTree $Target
  $manifest = Get-Content -LiteralPath (Join-Path $stageDir 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $entryPoints = @($manifest.background.service_worker, $manifest.action.default_popup)
  if (-not $entryPoints[0] -or -not $entryPoints[1]) { throw 'The release is missing its worker or popup entry point.' }
  foreach ($entry in $entryPoints) {
    $full = [IO.Path]::GetFullPath((Join-Path $stageDir $entry))
    if (-not $full.StartsWith($stageDir + '\', [StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-Path -LiteralPath $full -PathType Leaf)) { throw "Missing or invalid release entry point: $entry" }
  }

  # --- Sync ----------------------------------------------------------------
  # Copy first, delete second. That order is deliberate: once the copy lands the
  # extension is complete and working, so a failure in the delete pass leaves
  # stray files rather than a broken install.
  Write-Step "Updating $current -> $staged ..."
  Get-ChildItem -LiteralPath $stageDir -Recurse -File -Force | ForEach-Object {
    $rel = $_.FullName.Substring($stageDir.Length).TrimStart('\')
    if ((Test-Kept $rel) -or $rel -eq 'manifest.json') { return }
    $dest = Join-Path $Target $rel
    $destDir = Split-Path -Parent $dest
    if (-not (Test-Path -LiteralPath $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
    Copy-Item -LiteralPath $_.FullName -Destination $dest -Force
  }

  # The manifest is the Restart signal. Commit it only once every asset has
  # copied successfully, so a failed copy cannot advertise a ready update.
  Copy-Item -LiteralPath (Join-Path $stageDir 'manifest.json') -Destination (Join-Path $Target 'manifest.json') -Force

  # Vite emits content-hashed bundles, so without this pass every update would
  # leave the previous version's assets/*-<oldhash>.js behind forever.
  $stagedFiles = Get-RelativeFileSet $stageDir
  $removed = 0
  Get-ChildItem -LiteralPath $Target -Recurse -File -Force | ForEach-Object {
    $rel = $_.FullName.Substring($Target.Length).TrimStart('\')
    if (Test-Kept $rel) { return }
    if (-not $stagedFiles.ContainsKey($rel)) {
      Remove-Item -LiteralPath $_.FullName -Force
      $removed++
    }
  }

  # Directories the delete pass just emptied. Deepest-first so a nested empty
  # folder does not block its parent from being seen as empty too.
  Get-ChildItem -LiteralPath $Target -Recurse -Directory -Force |
    Sort-Object { $_.FullName.Length } -Descending |
    ForEach-Object {
      $rel = $_.FullName.Substring($Target.Length).TrimStart('\')
      if (Test-Kept $rel) { return }
      if (-not (Get-ChildItem -LiteralPath $_.FullName -Force)) { Remove-Item -LiteralPath $_.FullName -Force }
    }

  Write-Host ''
  Write-Host "Updated $current -> $staged" -ForegroundColor Green
  if ($removed -gt 0) { Write-Step "$removed file(s) from the old version removed." }
  Write-Host ''
  Write-Host 'The files are in place, but Chrome is still running the old version.' -ForegroundColor Cyan
  Write-Host 'Open the extension and click Restart — the button appears by itself' -ForegroundColor Cyan
  Write-Host 'once an update is waiting. Or click Reload on the card at' -ForegroundColor Cyan
  Write-Host 'chrome://extensions.' -ForegroundColor Cyan
  Write-Host ''
} finally {
  try {
    $tempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
    $cleanupPath = [IO.Path]::GetFullPath($work)
    if (-not $cleanupPath.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
      throw 'Staging cleanup escaped the temporary folder.'
    }
    Assert-RegularTree $cleanupPath
    Remove-Item -LiteralPath $cleanupPath -Recurse -Force
  } catch {
    Write-Warning "Could not clean up staging folder $work : $($_.Exception.Message)"
  }
}
