$def = @'
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
public delegate bool EnumProc(IntPtr h, IntPtr l);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern int GetWindowTextW(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern bool GetWindowPlacement(IntPtr h, ref WP p);
public struct RECT { public int L, T, R, B; }
public struct WP { public int Length, Flags, ShowCmd, MinX, MinY, MaxX, MaxY, L, T, R, B; }
'@
Add-Type -Name E -Namespace Q -MemberDefinition $def
$bravePids = @{}
Get-Process brave -ErrorAction SilentlyContinue | ForEach-Object { $bravePids[[uint32]$_.Id] = $true }
$resultat = New-Object System.Collections.ArrayList
$script:compteur = 0
$cb = [Q.E+EnumProc]{
	param($h, $l)
	$pid2 = [uint32]0
	[Q.E]::GetWindowThreadProcessId($h, [ref]$pid2) | Out-Null
	if ($script:bravePids.ContainsKey($pid2)) {
		$r = New-Object Q.E+RECT
		[Q.E]::GetWindowRect($h, [ref]$r) | Out-Null
		$p = New-Object Q.E+WP
		$p.Length = 44
		[Q.E]::GetWindowPlacement($h, [ref]$p) | Out-Null
		$sb = New-Object System.Text.StringBuilder 128
		[Q.E]::GetWindowTextW($h, $sb, 128) | Out-Null
		$t = $sb.ToString()
		if ($t.Length -gt 45) { $t = $t.Substring(0,45) }
		$vis = [Q.E]::IsWindowVisible($h)
		$larg = $r.R - $r.L
		$haut = $r.B - $r.T
		if ($vis -or ($larg -gt 80 -and $haut -gt 60)) {
			[void]$script:resultat.Add("hwnd=$h vis=$vis showCmd=$($p.ShowCmd) rect=($($r.L),$($r.T))-($($r.R),$($r.B)) titre='$t'")
		}
	}
	return $true
}
[Q.E]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
$resultat