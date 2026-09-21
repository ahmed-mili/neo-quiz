$def = @'
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
public struct RECT { public int L, T, R, B; }
'@
Add-Type -Name R -Namespace Q -MemberDefinition $def
$p = Get-Process brave -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
$h = $p.MainWindowHandle
"avant: hwnd=$h titre='$($p.MainWindowTitle)'"
$r = New-Object Q.R+RECT
[void][Q.R]::GetWindowRect($h, [ref]$r)
"rect avant = ($($r.L),$($r.T))-($($r.R),$($r.B))"
[void][Q.R]::ShowWindow($h, 9)  # SW_RESTORE
Start-Sleep -Milliseconds 300
[void][Q.R]::SetForegroundWindow($h)
[void][Q.R]::GetWindowRect($h, [ref]$r)
"rect apres = ($($r.L),$($r.T))-($($r.R),$($r.B)) visible=$([Q.R]::IsWindowVisible($h))"