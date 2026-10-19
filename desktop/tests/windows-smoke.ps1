# Workflow Detective: Windows smoke test.
# Runs the real app against a throwaway data folder, does a few things in Notepad and File Explorer, and checks
# what was (and wasn't) recorded. Takes about a minute. Don't touch the mouse or keyboard while it runs.
#
#   powershell -ExecutionPolicy Bypass -File tests\windows-smoke.ps1 [-Exe build\WorkflowDetective.exe] [-Excel]
#
# -Excel also tests the Excel connection (needs desktop Excel installed).
param([string]$Exe = "$PSScriptRoot\..\build\WorkflowDetective.exe", [switch]$Excel)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
$results = New-Object System.Collections.ArrayList
function Check($name, $ok, $detail = "") { [void]$results.Add([pscustomobject]@{ ok = [bool]$ok; name = $name; detail = $detail }) }

$Exe = (Resolve-Path $Exe).Path
$data = Join-Path $env:TEMP ("wd-smoke-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $data | Out-Null

# 1. built-in self-checks
$out = Join-Path $data "selftest.txt"
$p = Start-Process -FilePath $Exe -ArgumentList "--selftest --data `"$data\st`"" -Wait -PassThru -RedirectStandardOutput $out -NoNewWindow
Check "built-in self-checks pass on Windows" ($p.ExitCode -eq 0) ((Get-Content $out -Raw) -replace "`r?`n", " | ")

# 2. a study that is active right now
$today = (Get-Date).ToString("yyyy-MM-dd")
$kv = @{ settings = @{ consented = $true; startDate = $today; weeks = 1; scheduleMode = "fixed"; days = @(0,1,2,3,4,5,6); hourStart = 0; hourEnd = 24; captureTitles = $true; captureFieldLabels = $true; blocked = @() } }
[IO.File]::WriteAllText("$data\kv.json", ($kv | ConvertTo-Json -Depth 5))
$app = Start-Process -FilePath $Exe -ArgumentList "--data `"$data`" --port 47715" -PassThru
Start-Sleep -Seconds 4
Check "app starts and stays running" (-not $app.HasExited)
Check "local page server is up" (Test-Path "$data\server.json")

$shell = New-Object -ComObject WScript.Shell
$secret = "TYPED-SECRET-$(Get-Random -Minimum 1000 -Maximum 9999)"

# 3. Notepad: copy something, switch, type into it, save a file to Downloads
$np = Start-Process notepad -PassThru
Start-Sleep -Seconds 2
[void]$shell.AppActivate($np.Id); Start-Sleep -Milliseconds 800
[System.Windows.Forms.Clipboard]::SetText("1,200.00")
Start-Sleep -Milliseconds 800
[System.Windows.Forms.SendKeys]::SendWait($secret); Start-Sleep -Milliseconds 1500
[System.Windows.Forms.SendKeys]::SendWait(" more"); Start-Sleep -Seconds 5
$dl = Join-Path ([Environment]::GetFolderPath("UserProfile")) "Downloads"
$csv = Join-Path $dl ("wd-smoke-" + (Get-Random) + ".csv")
"a,b" | Out-File $csv
Start-Sleep -Seconds 3

# 4. Excel (optional)
if ($Excel) {
  $xl = New-Object -ComObject Excel.Application
  $xl.Visible = $true
  $wb = $xl.Workbooks.Add(); $ws = $wb.Worksheets.Item(1)
  $ws.Cells.Item(1, 1).Value2 = "Amount"
  Start-Sleep -Seconds 2
  [void]$shell.AppActivate("Excel"); Start-Sleep -Seconds 8     # the app connects to Excel while it's in front
  [System.Windows.Forms.Clipboard]::SetText("950.00"); Start-Sleep -Milliseconds 500
  [void]$shell.AppActivate("Excel"); Start-Sleep -Seconds 1
  $ws.Cells.Item(2, 1).Value2 = 950
  Start-Sleep -Seconds 6
  $wb.Close($false); $xl.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ws); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($wb); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
}

# 5. stop everything and read the log
Stop-Process -Id $np.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue
Remove-Item $csv -ErrorAction SilentlyContinue
$lines = @(); Get-ChildItem "$data\events\*.jsonl" -ErrorAction SilentlyContinue | ForEach-Object { $lines += Get-Content $_ }
$ev = $lines | ForEach-Object { $_ | ConvertFrom-Json }
$all = $lines -join "`n"
Check "something was recorded" ($ev.Count -gt 0) "$($ev.Count) events"
Check "switching to Notepad recorded as a view" (@($ev | Where-Object { $_.type -eq "view" -and $_.app -eq "Notepad" }).Count -ge 1) ((@($ev | Where-Object { $_.app } | ForEach-Object { $_.type + ":" + $_.app }) | Sort-Object -Unique) -join ", ")
Check "copy recorded with its kind (number)" (@($ev | Where-Object { $_.type -eq "copy" -and $_.d.kind -eq "number" }).Count -ge 1)
Check "typing in Notepad recorded as a field edit (label only)" (@($ev | Where-Object { $_.type -eq "entry" -and $_.app -eq "Notepad" }).Count -ge 1) (($ev | Where-Object { $_.type -eq "entry" } | ForEach-Object { $_.d.labels -join "/" }) -join "; ")
Check "new file in Downloads recorded by type" (@($ev | Where-Object { $_.type -eq "download" -and $_.d.ext -eq "csv" }).Count -ge 1)
Check "typed text never stored" (-not $all.Contains($secret.Substring(0, 12)) -and -not $all.Contains("more"))
Check "copied value never stored" (-not $all.Contains("1,200") -and -not $all.Contains("950"))
Check "Downloads file name never stored" (-not $all.Contains("wd-smoke-"))
if ($Excel) {
  $log = Get-Content "$data\log.txt" -Raw -ErrorAction SilentlyContinue
  Check "Excel connection established" ($log -match "Excel connected") (($log -split "`n" | Select-String "Excel") -join " | ")
  Check "Excel edit recorded with its column heading" (@($ev | Where-Object { $_.type -eq "entry" -and $_.app -eq "Excel" -and ($_.d.labels -contains "Amount") }).Count -ge 1)
}

""
$results | ForEach-Object { "{0} {1}{2}" -f $(if ($_.ok) { "PASS" } else { "FAIL" }), $_.name, $(if ($_.detail -and -not $_.ok) { "  -- " + $_.detail } else { "" }) }
$bad = @($results | Where-Object { -not $_.ok }).Count
""
"Data folder (log.txt has details): $data"
if ($bad) { "$bad check(s) failed"; exit 1 } else { "All $($results.Count) Windows checks passed"; exit 0 }
