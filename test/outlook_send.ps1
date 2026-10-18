# Click the "Send" button in the active Outlook-web compose tab in Chrome via UI Automation, then screenshot.
param([string]$Shot = "$env:TEMP\ol_after.png")
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms, System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public class W { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); }
"@
$chrome = Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $chrome) { "no chrome window"; exit 1 }
"window: $($chrome.MainWindowTitle)"
[W]::SetForegroundWindow($chrome.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 800
$root = [System.Windows.Automation.AutomationElement]::FromHandle($chrome.MainWindowHandle)
$cond = New-Object System.Windows.Automation.AndCondition(
  (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)),
  (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, "Send")))
$btn = $null
for ($i = 0; $i -lt 10 -and -not $btn; $i++) { $btn = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond); if (-not $btn) { Start-Sleep 1 } }
if (-not $btn) { "Send button not found"; exit 2 }
$btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
"clicked Send"
Start-Sleep 4
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
[System.Drawing.Graphics]::FromImage($bmp).CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$bmp.Save($Shot)
