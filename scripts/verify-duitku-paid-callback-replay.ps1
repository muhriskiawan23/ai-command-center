#requires -Version 5.1
<#
Read-only pre/post audit with two signed callback replays for an ALREADY-PAID
BOR AI Duitku SANDBOX invoice. Does not create invoices, transfer money, or
change production wallets. Secret prompts are hidden. Run after the Sandbox
Worker version containing GET /api/sandbox/orders/<id>/audit is deployed.
#>
param(
  [ValidatePattern('^BORTEST-[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$')]
  [string]$OrderId = 'BORTEST-993e9f82-5d72-4eb7-b510-452c5ea0adad'
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$base = 'https://bor-ai-duitku-sandbox.muhriskiawan23.workers.dev'
$merchantCode = 'DS38217'
$callbackPath = '/api/duitku/callback'
$amount = '10000'

function Assert-Audit([object]$audit, [string]$stage) {
  if ($audit.sandbox -ne $true -or $audit.orderId -ne $OrderId -or
      $audit.status -ne 'paid' -or [int]$audit.expectedCredits -ne 100 -or
      [int]$audit.ledgerEntries -ne 1 -or [int]$audit.ledgerCredits -ne 100 -or
      $audit.realCreditsGranted -ne $false) {
    throw ("Unsafe " + $stage + " audit: expected PAID, exactly one entry and 100 test credits. Stop.")
  }
}

$operatorSecret = Read-Host 'BOR AI Sandbox operator token (hidden)' -AsSecureString
$operatorPlain = [System.Net.NetworkCredential]::new('', $operatorSecret).Password
$headers = @{ Authorization = 'Bearer ' + $operatorPlain }
Remove-Variable operatorSecret,operatorPlain -ErrorAction SilentlyContinue

Write-Host 'Checking existing Sandbox order and credit ledger...'
$order = Invoke-RestMethod -Method Get -Uri ($base + '/api/sandbox/orders/' + $OrderId) -Headers $headers -ErrorAction Stop
if ($order.sandbox -ne $true -or $order.orderId -ne $OrderId -or
    $order.status -ne 'paid' -or [int]$order.amountIdr -ne 10000 -or
    [int]$order.testCredits -ne 100 -or $order.realCreditsGranted -ne $false) {
  throw 'Order is not a verified paid Sandbox order. No callbacks sent.'
}
$reference = [string]$order.reference
if ($reference -notmatch '^[A-Za-z0-9_-]{1,255}$') {
  throw 'Missing or invalid provider reference. No callbacks sent.'
}
$auditUri = $base + '/api/sandbox/orders/' + $OrderId + '/audit'
$before = Invoke-RestMethod -Method Get -Uri $auditUri -Headers $headers -ErrorAction Stop
Assert-Audit $before 'initial'
Write-Host 'Initial ledger: PAID / 1 entry / 100 test credits.'

$apiKeySecure = Read-Host 'Duitku DS38217 SANDBOX API key (hidden, NOT operator token)' -AsSecureString
$apiKey = [System.Net.NetworkCredential]::new('', $apiKeySecure).Password
if ($apiKey.Length -lt 10) { throw 'Invalid key length. No callbacks sent.' }
$keyBytes = [Text.Encoding]::UTF8.GetBytes($apiKey)
$hmac = $null
try {
  $hmac = [System.Security.Cryptography.HMACSHA256]::new($keyBytes)
  $dataBytes = [Text.Encoding]::UTF8.GetBytes($merchantCode + $amount + $OrderId)
  $signature = [BitConverter]::ToString($hmac.ComputeHash($dataBytes)).Replace('-', '').ToLowerInvariant()
  $form = @{
    merchantCode = $merchantCode
    amount = $amount
    merchantOrderId = $OrderId
    reference = $reference
    resultCode = '00'
    signature = $signature
  }
  1..2 | ForEach-Object {
    $reply = Invoke-RestMethod -Method Post -Uri ($base + $callbackPath) -ContentType 'application/x-www-form-urlencoded' -Body $form -ErrorAction Stop
    if ($reply.sandbox -ne $true -or $reply.received -ne $true) {
      throw 'Unexpected signed callback replay response.'
    }
    Write-Host ('Signed callback replay ' + $_ + ': HTTP 200, acknowledged')
  }
} finally {
  if ($null -ne $hmac) { $hmac.Dispose() }
  if ($null -ne $keyBytes) { [Array]::Clear($keyBytes, 0, $keyBytes.Length) }
  Remove-Variable apiKey,apiKeySecure,keyBytes,dataBytes,hmac,signature,form -ErrorAction SilentlyContinue
}
$after = Invoke-RestMethod -Method Get -Uri $auditUri -Headers $headers -ErrorAction Stop
Assert-Audit $after 'final'
Write-Host 'PASS: two signed callback replays; still exactly 1 ledger entry and 100 Sandbox test credits.'
Write-Host 'No new invoice, no production payment, no new real credits.'
