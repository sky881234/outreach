$host.UI.RawUI.WindowTitle = 'Outreach: Cloudflare login'
while ($true) {
    Write-Host ''
    Read-Host 'Press ENTER to open the Cloudflare login, then click Authorize within 2 minutes'
    wrangler login
    $who = wrangler whoami 2>&1 | Out-String
    if ($who -notmatch 'not authenticated') {
        Write-Host ''
        Write-Host 'Cloudflare connected. Tell Claude "done" - you can close this window.' -ForegroundColor Green
        break
    }
    Write-Host 'Not connected yet - try again.' -ForegroundColor Yellow
}
Read-Host 'Press ENTER to close'
