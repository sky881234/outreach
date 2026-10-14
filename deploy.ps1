# Creates (first run) or updates the Outreach sheet + Apps Script web app, and writes config.json.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$app = Join-Path $root 'apps_script'
$cfgPath = Join-Path $root 'config.json'
Set-Location $app

if (-not (Test-Path Secret.js)) {
    $s = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
    "const SECRET = '$s';" | Out-File Secret.js -Encoding ascii
}
$secret = ([regex]::Match((Get-Content Secret.js -Raw), "'([0-9a-f]+)'")).Groups[1].Value

if (-not (Test-Path .clasp.json)) {
    # clasp create pulls the default manifest over ours; keep a copy.
    Copy-Item appsscript.json "$env:TEMP\appsscript.keep.json" -Force
    clasp create-script --type sheets --title 'Outreach' --rootDir .
    if ($LASTEXITCODE) { throw 'clasp create failed' }
    Copy-Item "$env:TEMP\appsscript.keep.json" appsscript.json -Force
}

clasp push --force
if ($LASTEXITCODE) { throw 'clasp push failed' }

$cfg = @{}
if (Test-Path $cfgPath) {
    (Get-Content $cfgPath -Raw | ConvertFrom-Json).psobject.Properties | ForEach-Object { $cfg[$_.Name] = $_.Value }
}
if ($cfg.deployment_id) {
    clasp update-deployment $cfg.deployment_id --description 'outreach'
    if ($LASTEXITCODE) { throw 'clasp update-deployment failed' }
} else {
    $out = clasp create-deployment --description 'outreach' | Out-String
    $m = [regex]::Match($out, 'AKfy[\w-]+')
    if (-not $m.Success) { throw "no deployment id in: $out" }
    $cfg.deployment_id = $m.Value
}
$clasp = Get-Content .clasp.json -Raw | ConvertFrom-Json
$cfg.script_id = $clasp.scriptId
$cfg.secret = $secret
$cfg.webapp_url = "https://script.google.com/macros/s/$($cfg.deployment_id)/exec"
$cfg | ConvertTo-Json | Out-File $cfgPath -Encoding ascii
"Script editor: https://script.google.com/d/$($cfg.script_id)/edit"
"Web app: $($cfg.webapp_url)"
