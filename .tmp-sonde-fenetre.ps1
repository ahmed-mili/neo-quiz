param([long]$Hwnd)
$def = @'
[DllImport("user32.dll")] public static extern int GetWindowLongW(IntPtr h, int i);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
[DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
[DllImport("user32.dll")] public static extern int GetWindowTextW(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern int GetClassNameW(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
[DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int val, int size);
'@
Add-Type -Name W -Namespace Q -MemberDefinition $def
$style = [Q.W]::GetWindowLongW($Hwnd, -16)
$ex = [Q.W]::GetWindowLongW($Hwnd, -20)
$sb = New-Object System.Text.StringBuilder 128
[void][Q.W]::GetWindowTextW($Hwnd, $sb, 128)
$sbc = New-Object System.Text.StringBuilder 128
[void][Q.W]::GetClassNameW($Hwnd, $sbc, 128)
$pid2 = [uint32]0
[void][Q.W]::GetWindowThreadProcessId($Hwnd, [ref]$pid2)
$cloaked = 0
[void][Q.W]::DwmGetWindowAttribute($Hwnd, 14, [ref]$cloaked, 4)
$racine = [Q.W]::GetAncestor($Hwnd, 2) # GA_ROOT
$proprio = [Q.W]::GetWindow($Hwnd, 4)  # GW_OWNER
"fenetre=$Hwnd classe='$($sbc)' titre='$($sb)' pid=$pid2"
"style=0x{0:X8} exstyle=0x{1:X8} visible=$([Q.W]::IsWindowVisible($Hwnd)) cloakedDWM=$cloaked" -f $style, $ex
$exTool   = [bool]($ex -band 0x80)     # WS_EX_TOOLWINDOW
$exAppWin = [bool]($ex -band 0x40000)  # WS_EX_APPWINDOW
$exNoAct  = [bool]($ex -band 0x8000000)
"WS_EX_TOOLWINDOW=$exTool WS_EX_APPWINDOW=$exAppWin WS_EX_NOACTIVATE=$exNoAct"
"GA_ROOT=$racine owner=$proprio"
if ($racine -ne $Hwnd -and $racine -ne [IntPtr]::Zero) {
	$sb2 = New-Object System.Text.StringBuilder 128
	[void][Q.W]::GetWindowTextW($racine, $sb2, 128)
	$sbc2 = New-Object System.Text.StringBuilder 128
	[void][Q.W]::GetClassNameW($racine, $sbc2, 128)
	$exR = [Q.W]::GetWindowLongW($racine, -20)
	"  racine: hwnd=$racine classe='$($sbc2)' titre='$($sb2)' exstyle=0x{0:X8} TOOLWINDOW=$([bool]($exR -band 0x80))" -f $exR
}
$p = Get-Process -Id $pid2 -ErrorAction SilentlyContinue
if ($p) { "processus=$($p.ProcessName) MainWindowHandle=$($p.MainWindowHandle) MainWindowTitre='$($p.MainWindowTitle)'" }