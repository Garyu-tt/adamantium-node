# GENESIS R04 isolated, owner-authorized non-elevated deployment.
# Intended for execution through existing JediControl operator capability, never a persistent privileged agent.
# Does NOT modify Node-RED, R02, R03, tokens, firewall, services, or production directories.
$ErrorActionPreference = 'Stop'
$pin = 'ff731742cc9552709d5ed52eab095297b1f9087c'
$sha = '5e13361a770b30dce532642874f6490cfee8e649850f47287012f7945d4a8bcc'
$artifactUrl = "https://raw.githubusercontent.com/Garyu-tt/adamantium-node/$pin/experiments/genesis/r04-full.zip.b64"
$manifestUrl = "https://raw.githubusercontent.com/Garyu-tt/adamantium-node/$pin/experiments/genesis/r04-manifest.json"
$root = Join-Path $env:LOCALAPPDATA 'Mechanicus\experiments'
$target = Join-Path $root 'genesis_neural_stream_r04'
if (-not (Test-Path $root)) { throw 'Mechanicus experiments directory missing' }
if (Test-Path $target) { throw 'R04 installation already exists; refusing overwrite' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Elevated execution refused: R04 is standard-user only'
}
$nodeOutput = & node --version
if ($LASTEXITCODE -ne 0) { throw 'Node.js runtime unavailable' }
if (-not ($nodeOutput -match '^v(\d+)\.')) { throw 'Invalid Node.js version response' }
if ([int]$Matches[1] -lt 22) { throw 'Node.js 22 or newer required' }
$stage = Join-Path $root ('.genesis-r04-stage-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage -ErrorAction Stop | Out-Null
try {
  $manifest = (Invoke-WebRequest -Uri $manifestUrl -UseBasicParsing -TimeoutSec 20).Content | ConvertFrom-Json
  if ($manifest.schema -ne 'mechanicus.genesis-r04-handoff/1') { throw 'Manifest schema mismatch' }
  if ($manifest.artifact.sha256 -ne '7ca84cef40bd1bce9b521c57d5835da23187a44dc400fe465e3ff0387726315b') {
    throw 'Unexpected delta artifact reference'
  }
  $text = (Invoke-WebRequest -Uri $artifactUrl -UseBasicParsing -TimeoutSec 20).Content.Trim()
  if ($text.Length -ne 48060 -or $text -notmatch '^UEsD') { throw 'Unexpected full artifact encoding' }
  $archive = Join-Path $stage 'full.zip'
  [IO.File]::WriteAllBytes($archive, [Convert]::FromBase64String($text))
  if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sha) { throw 'Artifact SHA256 mismatch' }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($archive)
  try {
    $allow = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($p in $manifest.contents.PSObject.Properties) { [void]$allow.Add($p.Name) }
    foreach ($p in $manifest.vendored_from.genesis_neural_circuit_r03.PSObject.Properties) {
      [void]$allow.Add('vendor/r03/' + $p.Name)
    }
    if ($zip.Entries.Count -ne $allow.Count) { throw 'Unexpected ZIP entry count' }
    $found = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($item in $zip.Entries) {
      $name = $item.FullName
      if (-not $allow.Contains($name) -or -not $found.Add($name) -or $item.Length -gt 100000) {
        throw "Invalid or duplicate ZIP entry: $name"
      }
      $targetHash = if ($name.StartsWith('vendor/r03/')) {
        $rel = $name.Substring('vendor/r03/'.Length)
        $manifest.vendored_from.genesis_neural_circuit_r03.$rel
      } else { $manifest.contents.$name }
      $s = $item.Open()
      try {
        $hashAlgorithm = [Security.Cryptography.SHA256]::Create()
        try { $got = ([BitConverter]::ToString($hashAlgorithm.ComputeHash($s))).Replace('-', '').ToLowerInvariant() }
        finally { $hashAlgorithm.Dispose() }
      } finally { $s.Dispose() }
      if ($got -ne $targetHash) { throw "Entry checksum mismatch: $name" }
    }
  } finally { $zip.Dispose() }
  $runtime = Join-Path $stage 'runtime'
  [System.IO.Compression.ZipFile]::ExtractToDirectory($archive, $runtime)
  Push-Location $runtime
  try {
    & node --test .\test\r04.test.cjs | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'R04 tests failed' }
    & node --test .\vendor\r03\test\circuit.test.cjs | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'R03 regression tests failed' }
    $output = Join-Path $runtime 'runs'
    & node .\cli.cjs demo --pattern moving-bar --steps 120 --id r04-first --out $output | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'R04 demo failed' }
    $summary = Get-Content (Join-Path $output 'r04-first-summary.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($summary.mode -ne 'synthetic-only' -or $summary.summary.total_spikes -ne 2646 -or
        $summary.summary.genomes_unchanged -ne $true -or
        $summary.summary.sensory_stream.accepted -ne 120) { throw 'R04 deterministic invariants failed' }
  } finally { Pop-Location }
  if (Test-Path $target) { throw 'Concurrent R04 installation detected' }
  Move-Item -LiteralPath $runtime -Destination $target -ErrorAction Stop
  $proof = [ordered]@{
    schema = 'mechanicus.genesis-r04-deployment-evidence/1'
    provenance_commit = $pin
    sha256 = $sha
    checked_utc = [DateTime]::UtcNow.ToString('o')
    result = 'verified'
    r04_tests = 26
    r03_regressions = 15
    moving_bar_spikes = 2646
    source_genomes_unchanged = $true
    node_red_changed = $false
    executor = 'JediControl owner-authorized standard-user'
  }
  $evidence = Join-Path $target 'deployment-evidence.json'
  [IO.File]::WriteAllText($evidence, ($proof | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
  'GENESIS_R04_DEPLOYED=verified'
  'GENESIS_R04_PATH=' + $target
  'GENESIS_R04_TESTS=26/26'
  'GENESIS_R03_REGRESSIONS=15/15'
  'GENESIS_R04_SPIKES=2646'
} finally {
  if (Test-Path $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
}
