import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const updater = fileURLToPath(new URL('../updater/Update Gingerbread.ps1', import.meta.url))
const name = 'Reward Routine Automator — Gingerbread'
const manifest = (version: string, build = name) => JSON.stringify({
  manifest_version: 3, name: build, version,
  background: { service_worker: 'worker.js' }, action: { default_popup: 'index.html' },
})

// Run the real updater against disposable folders. Both network cmdlets and
// extraction are replaced: no requests or installation targets are reachable.
function exercise(options: { version?: string; build?: string; targetBuild?: string; failAsset?: boolean; missingWorker?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'gingerbread-updater-test-'))
  const target = join(root, 'installed')
  const release = join(root, 'release')
  mkdirSync(join(target, 'updater'), { recursive: true })
  mkdirSync(join(release, 'assets'), { recursive: true })
  mkdirSync(join(release, 'updater'), { recursive: true })
  writeFileSync(join(target, 'manifest.json'), manifest('6.9.8', options.targetBuild))
  writeFileSync(join(target, 'old.js'), 'old asset')
  writeFileSync(join(target, 'updater', 'keep.cmd'), 'keep updater')
  writeFileSync(join(release, 'manifest.json'), manifest(options.version ?? '6.10.0', options.build))
  if (!options.missingWorker) writeFileSync(join(release, 'worker.js'), 'new worker')
  writeFileSync(join(release, 'index.html'), 'new popup')
  writeFileSync(join(release, 'assets', 'new.js'), 'new asset')
  writeFileSync(join(release, 'updater', 'keep.cmd'), 'must not replace updater')
  const wrapper = join(root, 'offline.ps1')
  writeFileSync(wrapper, `
$ErrorActionPreference = 'Stop'
function Invoke-RestMethod {
  @(
    @{ draft = $true; assets = @(@{ name = 'Gingerbread-draft.zip'; browser_download_url = 'draft' }) },
    @{ prerelease = $true; assets = @(@{ name = 'Gingerbread-preview.zip'; browser_download_url = 'preview' }) },
    @{ tag_name = 'stable'; assets = @(@{ name = 'Gingerbread.zip'; browser_download_url = 'offline' }) }
  )
}
function Invoke-WebRequest {
  param($Uri, $OutFile, $UserAgent, [switch]$UseBasicParsing)
  if ($Uri -ne 'offline') { throw 'Updater selected an unstable release' }
  Set-Content -LiteralPath $OutFile -Value 'offline fixture'
}
function Expand-Archive {
  param($LiteralPath, $DestinationPath, [switch]$Force)
  New-Item -ItemType Directory -Path $DestinationPath | Out-Null
  Get-ChildItem -LiteralPath $env:GB_RELEASE -Force | ForEach-Object {
    Microsoft.PowerShell.Management\\Copy-Item -LiteralPath $_.FullName -Destination $DestinationPath -Recurse -Force
  }
}
function Copy-Item {
  param($LiteralPath, $Destination, [switch]$Force)
  if ($env:GB_FAIL_ASSET -eq 'yes' -and $LiteralPath.EndsWith('new.js')) { throw 'Simulated asset-copy failure' }
  if ($LiteralPath.EndsWith('manifest.json') -and -not (Test-Path -LiteralPath (Join-Path $env:GB_TARGET 'assets/new.js'))) {
    throw 'Manifest copied before assets'
  }
  Microsoft.PowerShell.Management\\Copy-Item -LiteralPath $LiteralPath -Destination $Destination -Force
}
& $env:GB_UPDATER -Target $env:GB_TARGET
exit $LASTEXITCODE
`, 'utf8')
  const run = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wrapper], {
    encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, GB_RELEASE: release, GB_TARGET: target, GB_UPDATER: updater, GB_FAIL_ASSET: options.failAsset ? 'yes' : 'no' },
  })
  const result = {
    status: run.status, output: run.stdout + run.stderr, error: run.error,
    installed: JSON.parse(readFileSync(join(target, 'manifest.json'), 'utf8')),
    updater: readFileSync(join(target, 'updater', 'keep.cmd'), 'utf8'),
    oldAsset: existsSync(join(target, 'old.js')), newAsset: existsSync(join(target, 'assets', 'new.js')),
  }
  rmSync(root, { recursive: true, force: true })
  assert.equal(run.error, undefined, String(run.error))
  return result
}

test('offline updater installs newer stable Gingerbread assets before the manifest and preserves itself', { skip: process.platform !== 'win32' }, () => {
  const result = exercise()
  assert.equal(result.status, 0, result.output)
  assert.equal(result.installed.version, '6.10.0')
  assert.equal(result.newAsset, true)
  assert.equal(result.oldAsset, false)
  assert.equal(result.updater, 'keep updater')
})

for (const version of ['6.9.7', '6.9.8', '6.9.8.0']) {
  test(`offline updater refuses older/equal version ${version}`, { skip: process.platform !== 'win32' }, () => {
    const result = exercise({ version })
    assert.equal(result.status, 0, result.output)
    assert.equal(result.installed.version, '6.9.8')
    assert.equal(result.oldAsset, true)
    assert.equal(result.newAsset, false)
  })
}

for (const options of [
  { build: 'Reward Routine Automator — Froyo' },
  { targetBuild: 'Reward Routine Automator — Froyo' },
  { version: 'invalid' },
  { version: '99999.0.0' },
  { missingWorker: true },
  { failAsset: true },
]) {
  test(`offline updater preserves the manifest on validation/copy failure ${JSON.stringify(options)}`, { skip: process.platform !== 'win32' }, () => {
    const result = exercise(options)
    assert.notEqual(result.status, 0, result.output)
    assert.equal(result.installed.version, '6.9.8')
    assert.equal(result.oldAsset, true)
    assert.equal(result.updater, 'keep updater')
  })
}
