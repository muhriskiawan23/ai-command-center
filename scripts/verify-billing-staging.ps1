#requires -Version 5.1
<#
BOR AI BILLING SANDBOX ONLY.
Defaults to read-only health check. Explicit switches are required to create
a test invoice or to audit an existing staging order. NEVER sends real money.
Do not pass a secret in script arguments, logs or chat.
#>
param(
  [Parameter(Mandatory=$true)]
  [ValidatePattern('^https://bor-ai-billing-staging\.[a-z0-9-]+\.workers\.dev$')]
  [string]$BaseUrl,
  [ValidateSet('basic','pro')]
  [string]$Sku='basic',
  [switch]$CreateSandboxInvoice,
  [ValidatePattern('^BSTAGE-[a-f0-9]{40}$')]
  [string]$AuditOrderId
)
$ErrorActionPreference='Stop'
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
$base=$BaseUrl.TrimEnd('/')
$health=Invoke-RestMethod -UseBasicParsing -Method Get -Uri ($base+'/health') -ErrorAction Stop
if($health.sandbox -ne $true -or $health.productionCheckoutEnabled -ne $false){
  throw 'Incorrect staging target. Refusing.'
}
Write-Host ('Staging health: configured=' + $health.configured)
if(-not $CreateSandboxInvoice -and -not $AuditOrderId){
  Write-Host 'Read-only health check complete. No invoice, no payment, no credit grant.'
  exit 0
}
if($health.configured -ne $true){
  throw 'Billing staging is disabled or missing independent D1/secrets.'
}
$secret=Read-Host 'Billing STAGING operator token (hidden; never paste to chat)' -AsSecureString
$plain=[System.Net.NetworkCredential]::new('',$secret).Password
$headers=@{ Authorization=('Bearer '+$plain) }
Remove-Variable plain,secret -ErrorAction SilentlyContinue
if($AuditOrderId){
  $uri=$base+'/api/billing-sandbox/operator/audit?orderId='+$AuditOrderId
  $audit=Invoke-RestMethod -UseBasicParsing -Method Get -Uri $uri -Headers $headers -ErrorAction Stop
  $audit | Select-Object orderId,status,amountIdr,expectedCredits,ledgerEntries,ledgerCredits,walletReconciled,realCreditsGranted | Format-List
  if($audit.realCreditsGranted -ne $false){throw 'Unexpected real-credit flag'}
  if($audit.status -eq 'paid' -and ($audit.ledgerEntries -ne 1 -or $audit.ledgerCredits -ne $audit.expectedCredits -or $audit.walletReconciled -ne $true)){
    throw 'STAGING LEDGER AUDIT FAILED: do not activate customer payments.'
  }
}
if($CreateSandboxInvoice){
  Write-Host ('Explicit Sandbox invoice requested: '+$Sku)
  $start=Invoke-WebRequest -UseBasicParsing -Method Post -Uri ($base+'/api/billing-sandbox/operator/session') -Headers $headers -SessionVariable browser -ErrorAction Stop
  $who=Invoke-RestMethod -UseBasicParsing -Method Get -Uri ($base+'/api/billing-sandbox/me') -WebSession $browser -ErrorAction Stop
  if($who.sandbox -ne $true -or -not $who.csrfToken -or $who.realCreditsGranted -ne $false){
    throw 'Invalid staging-only login/CSRF state. No invoice sent.'
  }
  $id=([guid]::NewGuid()).ToString().ToLowerInvariant()
  $json=@{ sku=$Sku; requestId=$id } | ConvertTo-Json -Compress
  $checkout=Invoke-RestMethod -UseBasicParsing -Method Post -Uri ($base+'/api/billing-sandbox/checkout') -WebSession $browser -ContentType 'application/json' -Headers @{Origin=$base;'X-BOR-Billing-CSRF'=$who.csrfToken} -Body $json -ErrorAction Stop
  if($checkout.sandbox -ne $true -or $checkout.realCreditsGranted -ne $false -or
    $checkout.productionCheckoutEnabled -ne $false -or
    $checkout.paymentUrl -notmatch '^https://sandbox\.duitku\.com/'){
    throw 'Unexpected checkout result: do not proceed.'
  }
  Write-Host ('STAGING invoice: '+$checkout.orderId)
  Write-Host ('IDR test amount: '+$checkout.amountIdr)
  Write-Host ('Duitku SANDBOX payment page: '+$checkout.paymentUrl)
  Write-Host 'Only use Duitku simulated payment; do NOT transfer real money.'
  Write-Host 'After simulated payment, run this script again with -AuditOrderId.'
}
