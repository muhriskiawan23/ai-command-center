#requires -Version 5.1
<#
Upgrade ONLY the isolated BOR AI billing staging callback telemetry.
Requires the operator's existing Cloudflare Wrangler login on this PC.
No payment is made, no invoice is created, and no secret is printed.
Download this script from the merged, pinned GitHub commit, and pass the
same commit hash via -Commit.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)]
  [ValidatePattern('^[a-f0-9]{40}$')]
  [string]$Commit,
  [Parameter(Mandatory=$true)]
  [switch]$ConfirmSandboxOnly,
  [string]$ProjectPath=(Join-Path $env:LOCALAPPDATA 'Temp\bor-ai-billing-8d2440b1\ai-command-center-main')
)
$ErrorActionPreference='Stop'
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
if(-not $ConfirmSandboxOnly){throw 'Only -ConfirmSandboxOnly can authorize an isolated staging upgrade.'}
if(-not (Test-Path -LiteralPath $ProjectPath -PathType Container)){throw 'Existing local staging project missing.'}
Push-Location -LiteralPath $ProjectPath
try {
  $configPath='wrangler.billing-staging.generated.jsonc'
  if(-not (Test-Path -LiteralPath $configPath -PathType Leaf)){throw 'Generated staging config missing.'}
  $cfg=Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  $expectedId='437ad1fb-2715-40f6-a6a8-71808c2e916a'
  $expectedOrigin='https://bor-ai-billing-staging.muhriskiawan23.workers.dev'
  if($cfg.name -ne 'bor-ai-billing-staging' -or
     $cfg.main -ne 'src/billing-staging-worker.js' -or
     @($cfg.d1_databases).Count -ne 1 -or
     $cfg.d1_databases[0].binding -ne 'BILLING_DB' -or
     $cfg.d1_databases[0].database_name -ne 'bor-ai-billing-staging' -or
     $cfg.d1_databases[0].database_id -ne $expectedId -or
     $cfg.d1_databases[0].migrations_dir -ne 'staging/billing/migrations' -or
     $cfg.vars.STAGING_D1_NAME -ne 'bor-ai-billing-staging' -or
     $cfg.vars.STAGING_PUBLIC_ORIGIN -ne $expectedOrigin -or
     $cfg.vars.BILLING_STAGING_ENABLED -ne 'true' -or
     $cfg.vars.BILLING_STAGING_ALLOW_TEST_INVOICES -ne 'true'){
       throw 'STOP: Target is not the approved dedicated billing STAGING Worker and D1.'
  }
  $originCheck=Invoke-RestMethod -UseBasicParsing -Uri ($expectedOrigin+'/health') -TimeoutSec 20
  if($originCheck.sandbox -ne $true -or
     $originCheck.isolatedBilling -ne $true -or
     $originCheck.productionCheckoutEnabled -ne $false -or
     $originCheck.realCreditsGranted -ne $false){
       throw 'STOP: Remote staging safety flags do not match.'
  }
  $tmp=Join-Path $env:TEMP ('bor-billing-diag-'+[guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp -ErrorAction Stop | Out-Null
  $relativePaths=@(
    'src/billing-staging-worker.js',
    'src/billing-synthetic-gateway-bridge.js',
    'staging/billing/migrations/0006_callback_diagnostic_buckets.sql'
  )
  foreach($relative in $relativePaths){
    $uri='https://raw.githubusercontent.com/muhriskiawan23/ai-command-center/'+$Commit+'/'+$relative
    $target=Join-Path $tmp $relative.Replace('/','\')
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    Invoke-WebRequest -UseBasicParsing -Uri $uri -OutFile $target -ErrorAction Stop
    if($relative.EndsWith('.js')){
      & node --check $target
      if($LASTEXITCODE -ne 0){throw ('JavaScript syntax check failed: '+$relative)}
    }
  }
  if(-not (Select-String -Path (Join-Path $tmp 'src/billing-staging-worker.js') -Pattern 'staging_callback_diagnostic_buckets' -SimpleMatch) -or
     -not (Select-String -Path (Join-Path $tmp 'staging/billing/migrations/0006_callback_diagnostic_buckets.sql') -Pattern 'CREATE TABLE staging_callback_diagnostic_buckets' -SimpleMatch)){
       throw 'Downloaded code/migration does not include callback diagnostic instrumentation.'
  }
  $backup=Join-Path $tmp 'originals'
  New-Item -ItemType Directory -Path $backup | Out-Null
  foreach($relative in $relativePaths){
    $local=Join-Path $ProjectPath $relative.Replace('/','\')
    if(Test-Path -LiteralPath $local){
      $backupFile=Join-Path $backup $relative.Replace('/','\')
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $backupFile) | Out-Null
      Copy-Item -LiteralPath $local -Destination $backupFile -ErrorAction Stop
    }
  }
  foreach($relative in $relativePaths){
    $local=Join-Path $ProjectPath $relative.Replace('/','\')
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $local) | Out-Null
    Copy-Item -LiteralPath (Join-Path $tmp $relative.Replace('/','\')) -Destination $local -Force -ErrorAction Stop
  }
  Write-Host 'Verified dedicated STAGING Worker/D1 and new migration.'
  Write-Host 'Applying only pending staging D1 migrations, remotely...'
  & npx.cmd --yes wrangler@4.165.0 d1 migrations apply bor-ai-billing-staging --remote --config $configPath
  if($LASTEXITCODE -ne 0){throw 'D1 staging migration failed; Worker not deployed. Original source files backed up in temporary folder.'}
  Write-Host 'Deploying only isolated billing staging Worker...'
  & npx.cmd --yes wrangler@4.165.0 deploy --config $configPath
  if($LASTEXITCODE -ne 0){throw 'STAGING Worker deployment failed; do not proceed with callback resend.'}
  $health=Invoke-RestMethod -UseBasicParsing -Uri ($expectedOrigin+'/health') -TimeoutSec 20
  if($health.configured -ne $true -or $health.isolatedBilling -ne $true -or
     $health.productionCheckoutEnabled -ne $false -or $health.realCreditsGranted -ne $false){
       throw 'Remote staging health validation failed.'
  }
  Write-Host 'PASS: Isolated billing staging callback diagnostic upgrade deployed. No payments made.'
  Write-Host 'Endpoint: GET /api/billing-sandbox/operator/callback-diagnostics?hours=24'
  Write-Host 'Token must stay private. GitHub Actions reporting requires a separate GH repository secret.'
} finally {
  Pop-Location
}
