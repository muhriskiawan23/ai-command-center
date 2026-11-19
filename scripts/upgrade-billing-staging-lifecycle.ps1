#requires -Version 5.1
<#
Isolated BOR AI BILLING STAGING ONLY. Owner-driven, PINNED-COMMIT upgrade.
Requires GH CLI auth and Wrangler Cloudflare access on the owner's Windows PC.
Only -ConfirmSandboxOnly -EnableSimulation authorizes applying migrations and
redeploying the isolated billing staging Worker. This script creates NO
invoice/payment, does NOT call real AI, and cannot deploy production.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)]
  [ValidatePattern('^[a-f0-9]{40}$')]
  [string]$Commit,
  [Parameter(Mandatory=$true)]
  [switch]$ConfirmSandboxOnly,
  [Parameter(Mandatory=$true)]
  [switch]$EnableSimulation,
  [string]$ProjectPath=(Join-Path $env:LOCALAPPDATA 'Temp\bor-ai-billing-8d2440b1\ai-command-center-main')
)
$ErrorActionPreference='Stop'
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12

if(-not $ConfirmSandboxOnly -or -not $EnableSimulation){
  throw 'STOP: Explicit sandbox-only and simulation opt-in are mandatory.'
}
if(-not (Test-Path -LiteralPath $ProjectPath -PathType Container)){
  throw 'STOP: Dedicated local staging project directory missing.'
}
if(-not (Get-Command gh -ErrorAction SilentlyContinue)){
  throw 'STOP: GitHub CLI missing.'
}
if(-not (Get-Command node -ErrorAction SilentlyContinue)){
  throw 'STOP: Node.js missing.'
}
& gh auth status | Out-Null
if($LASTEXITCODE -ne 0){throw 'STOP: Authenticate GitHub CLI first.'}

$expectedUuid='437ad1fb-2715-40f6-a6a8-71808c2e916a'
$expectedOrigin='https://bor-ai-billing-staging.muhriskiawan23.workers.dev'
$cfgPath=Join-Path $ProjectPath 'wrangler.billing-staging.generated.jsonc'
if(-not (Test-Path -LiteralPath $cfgPath -PathType Leaf)){
  throw 'STOP: Generated local billing staging Wrangler config missing.'
}
$cfg=Get-Content -LiteralPath $cfgPath -Raw | ConvertFrom-Json
if($cfg.name -ne 'bor-ai-billing-staging' -or
   $cfg.main -ne 'src/billing-staging-worker.js' -or
   @($cfg.d1_databases).Count -ne 1 -or
   $cfg.d1_databases[0].binding -ne 'BILLING_DB' -or
   $cfg.d1_databases[0].database_name -ne 'bor-ai-billing-staging' -or
   $cfg.d1_databases[0].database_id -ne $expectedUuid -or
   $cfg.d1_databases[0].migrations_dir -ne 'staging/billing/migrations' -or
   $cfg.vars.STAGING_D1_NAME -ne 'bor-ai-billing-staging' -or
   $cfg.vars.STAGING_PUBLIC_ORIGIN -ne $expectedOrigin -or
   $cfg.vars.BILLING_STAGING_ENABLED -ne 'true' -or
   $cfg.vars.BILLING_STAGING_ALLOW_TEST_INVOICES -ne 'true'){
  throw 'STOP: Worker/DB/config is NOT the exact dedicated billing staging target.'
}
$health=Invoke-RestMethod -UseBasicParsing -Uri ($expectedOrigin+'/health') -TimeoutSec 20
if($health.sandbox -ne $true -or $health.isolatedBilling -ne $true -or
   $health.configured -ne $true -or
   $health.productionCheckoutEnabled -ne $false -or
   $health.realCreditsGranted -ne $false){
  throw 'STOP: Existing remote staging safety flags do not match.'
}
# Do not download any production Worker or production Wrangler configuration.
$paths=@(
  'src/billing-staging-worker.js',
  'src/billing-synthetic-usage-reservations.js',
  'src/billing-provider-metering-offline.js',
  'src/billing-manual-subscriptions-offline.js',
  'src/billing-ledger-foundation.js',
  'src/credit-metering.js',
  'src/billing-quote-core.js',
  'staging/billing/migrations/0007_synthetic_usage_reservations.sql',
  'staging/billing/migrations/0008_manual_subscription_terms.sql',
  'tests/billing-staging-worker.test.js',
  'tests/billing-synthetic-usage-reservations.test.js',
  'tests/billing-manual-subscriptions-offline.test.js'
)
$tmp=Join-Path $env:TEMP ('bor-billing-lifecycle-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp -ErrorAction Stop | Out-Null
$staged=Join-Path $tmp 'verified'
$backups=Join-Path $tmp 'backups'
New-Item -ItemType Directory -Path $staged | Out-Null
New-Item -ItemType Directory -Path $backups | Out-Null
Write-Host 'Checked exact billing staging Worker and D1 UUID; downloading pinned GitHub sources.'
foreach($relative in $paths){
  $encoded=& gh api ('repos/muhriskiawan23/ai-command-center/contents/'+$relative+'?ref='+$Commit) --jq '.content'
  if($LASTEXITCODE -ne 0 -or -not $encoded){throw ('GitHub pinned content not found: '+$relative)}
  try{$bytes=[Convert]::FromBase64String((($encoded -join '') -replace '\s',''))}
  catch{throw ('Invalid GitHub file encoding: '+$relative)}
  $destination=Join-Path $staged $relative.Replace('/','\')
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
  [System.IO.File]::WriteAllBytes($destination,$bytes)
  if($relative.EndsWith('.js')){
    & node --check $destination
    if($LASTEXITCODE -ne 0){throw ('Syntax check failed: '+$relative)}
  }
}
$source=Get-Content -LiteralPath (Join-Path $staged 'src\billing-staging-worker.js') -Raw
if(-not $source.Contains('BILLING_STAGING_SIMULATION_ENABLED') -or
   -not $source.Contains('fixed_server_test_fixture_not_a_provider_bill')){
  throw 'STOP: Pinned Worker does not include the approved simulation safety gates.'
}
$originalConfig=Get-Content -LiteralPath $cfgPath -Raw
Push-Location -LiteralPath $ProjectPath
try {
  foreach($relative in $paths){
    $local=Join-Path $ProjectPath $relative.Replace('/','\')
    if(Test-Path -LiteralPath $local){
      $backup=Join-Path $backups $relative.Replace('/','\')
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $backup) | Out-Null
      Copy-Item -LiteralPath $local -Destination $backup -ErrorAction Stop
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $local) | Out-Null
    Copy-Item -LiteralPath (Join-Path $staged $relative.Replace('/','\')) -Destination $local -Force
  }
  Write-Host 'Running local isolated billing, subscription and credits regression tests...'
  & node --test tests/billing-staging-worker.test.js tests/billing-synthetic-usage-reservations.test.js tests/billing-manual-subscriptions-offline.test.js
  if($LASTEXITCODE -ne 0){throw 'STOP: Local staging tests failed; D1 NOT migrated.'}
  Write-Host 'Preparing isolated staging flag (never production config)...'
  $cfg.vars | Add-Member -NotePropertyName 'BILLING_STAGING_SIMULATION_ENABLED' -NotePropertyValue 'true' -Force
  $utf8=New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($cfgPath,($cfg | ConvertTo-Json -Depth 40),$utf8)
  Write-Host 'Applying only pending migrations to isolated staging D1 (0007/0008)...'
  & npx.cmd --yes wrangler@4.165.0 d1 migrations apply bor-ai-billing-staging --remote --config wrangler.billing-staging.generated.jsonc
  if($LASTEXITCODE -ne 0){throw 'STOP: Dedicated staging D1 migration failed; Worker not deployed.'}
  Write-Host 'Deploying only isolated billing staging Worker...'
  & npx.cmd --yes wrangler@4.165.0 deploy --config wrangler.billing-staging.generated.jsonc
  if($LASTEXITCODE -ne 0){throw 'STOP: Staging Worker deploy failed; production untouched.'}
  $after=Invoke-RestMethod -UseBasicParsing -Uri ($expectedOrigin+'/health') -TimeoutSec 20
  if($after.configured -ne $true -or $after.sandbox -ne $true -or
     $after.isolatedBilling -ne $true -or
     $after.productionCheckoutEnabled -ne $false -or
     $after.realCreditsGranted -ne $false){
    throw 'STOP: Remote staging health check did not pass.'
  }
  # A new owner-issued synthetic session is required; anonymous requests
  # must never read this endpoint after simulation has been enabled.
  $anonymousStatus=0
  try{
    $unexpected=Invoke-WebRequest -UseBasicParsing -Uri ($expectedOrigin+'/api/billing-sandbox/simulation/plan') -TimeoutSec 20
    $anonymousStatus=[int]$unexpected.StatusCode
  }catch{
    if($_.Exception.Response){$anonymousStatus=[int]$_.Exception.Response.StatusCode}
    else{throw}
  }
  if($anonymousStatus -ne 401){
    throw ('STOP: Expected an authenticated-only staging simulation route, received HTTP '+$anonymousStatus)
  }
  Write-Host 'PASS: Dedicated staging D1 migrations and Worker configured; anonymous access denied.'
  Write-Host 'PASS: Real payments/real credits OFF. No new invoice or external AI call.'
}finally{
  Pop-Location
  Write-Host ('Staging file backups are in: '+$backups)
  Write-Host 'Never copy staging D1 or secrets into production.'
}
