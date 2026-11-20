# No UAC. Only the caller's existing, explicitly authorized JediControl/MAS scope.
# Not meant to be invoked by an untrusted flow, remote anonymous request or scheduler.
$ErrorActionPreference='Stop'
$localRoot=$env:LOCALAPPDATA
if([string]::IsNullOrWhiteSpace($localRoot)){throw 'LOCALAPPDATA unavailable'}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=[Security.Principal.WindowsPrincipal]::new($identity)
if($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
  throw 'Elevated execution is not permitted for GENESIS Operator R04'
}
$operatorDir=Join-Path $localRoot 'Mechanicus\ops\genesis-operator-r01'
$runningFile=Join-Path $operatorDir 'operator.cjs'
$sourceFile=Join-Path $PSScriptRoot 'operator.cjs'
$r04=Join-Path $localRoot 'Mechanicus\experiments\genesis_neural_stream_r04'
$evidence=Join-Path $r04 'deployment-evidence.json'
$baseline='9fb1bd0e33202013ead5431ae7de055851392ccca9291d1f75cadd1398609551'
$newHash='9216cf904b77b66c8e503664c39660cff98301ec757fa7e5b5451d82fd32de5b'
if(!(Test-Path $runningFile)){throw 'Operator R01 not installed; refusing implicit installation'}
if(!(Test-Path $sourceFile)){throw 'Candidate operator file missing'}
if(!(Test-Path (Join-Path $r04 'package.json'))){throw 'R04 runtime must be independently deployed first'}
if(!(Test-Path $evidence)){throw 'R04 deployment evidence missing'}
$proof=Get-Content $evidence -Raw -Encoding UTF8|ConvertFrom-Json
if($proof.schema -ne 'mechanicus.genesis-r04-deployment-evidence/1' -or
   $proof.sha256 -ne '5e13361a770b30dce532642874f6490cfee8e649850f47287012f7945d4a8bcc' -or
   $proof.provenance_commit -ne 'ff731742cc9552709d5ed52eab095297b1f9087c' -or
   $proof.result -ne 'verified' -or $proof.source_genomes_unchanged -ne $true){
 throw 'R04 runtime not backed by expected pinned deployment evidence'
}
if((Get-FileHash $sourceFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $newHash){
 throw 'Operator R04 package SHA256 failed'
}
$current=(Get-FileHash $runningFile -Algorithm SHA256).Hash.ToLowerInvariant()
if($current -eq $newHash){'OPERATOR_R04_ALREADY_INSTALLED=true';exit 0}
if($current -ne $baseline){throw 'Installed Operator R01 differs from verified baseline; refusing overwrite'}
& node --check $sourceFile
if($LASTEXITCODE -ne 0){throw 'Operator R04 JavaScript syntax invalid'}
$checked=& node $sourceFile status 2>&1
if($LASTEXITCODE -ne 0){throw 'Candidate Operator status failed'}
$data=$checked|Select-Object -Last 1|ConvertFrom-Json
if($data.schema -ne 'mechanicus.genesis-operator/1' -or
   $data.installed.r04 -ne $true -or
   @($data.available_actions|Where-Object {$_ -eq 'test-r04'}).Count -ne 1){
 throw 'Candidate Operator R04 contract failed'
}
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$backup=Join-Path $operatorDir ('operator.cjs.before-r04-'+$stamp+'.bak')
if(Test-Path $backup){throw 'Backup collision; refusing overwrite'}
Copy-Item -LiteralPath $runningFile -Destination $backup -ErrorAction Stop
if((Get-FileHash $backup -Algorithm SHA256).Hash.ToLowerInvariant() -ne $baseline){
 throw 'Operator baseline backup integrity failure'
}
$staged=Join-Path $operatorDir ('operator-r04-'+$stamp+'.stage')
try{
 Copy-Item -LiteralPath $sourceFile -Destination $staged -ErrorAction Stop
 Move-Item -LiteralPath $staged -Destination $runningFile -Force -ErrorAction Stop
 if((Get-FileHash $runningFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $newHash){
  throw 'Installed Operator R04 SHA256 mismatch'
 }
 & node $runningFile status |Out-Null
 if($LASTEXITCODE -ne 0){throw 'Installed operator status failed'}
 'OPERATOR_R04_INSTALLED=true'
 'OPERATOR_BACKUP='+$backup
 'OPERATOR_HASH='+$newHash
}catch{
 Copy-Item -LiteralPath $backup -Destination $runningFile -Force -ErrorAction Stop
 'OPERATOR_R04_ROLLBACK=completed'
 throw
}finally{if(Test-Path $staged){Remove-Item -LiteralPath $staged -Force -ErrorAction SilentlyContinue}}
