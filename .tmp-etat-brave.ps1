$def = @'
[DllImport("user32.dll")] public static extern bool GetWindowPlacement(IntPtr h, ref WP p);
public struct WP { public int Length, Flags, ShowCmd, MinX, MinY, MaxX, MaxY, L, T, R, B; }
'@
Add-Type -Name P -Namespace Q -MemberDefinition $def
"=== placement des fenetres Brave ==="
Get-Process brave -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.MainWindowHandle -ne 0) {
    $h = $_.MainWindowHandle
    $p = New-Object Q.P+WP; $p.Length = 44
    [void][Q.P]::GetWindowPlacement([IntPtr]$h, [ref]$p)
    "hwnd=$h pid=$($_.Id) showCmd=$($p.ShowCmd) normal=($($p.L),$($p.T))-($($p.R),$($p.B)) titre='$($_.MainWindowTitle.Substring(0,[Math]::Min(40,$_.MainWindowTitle.Length)))'"
  }
}
"=== boutons de la barre des taches (UIA) ==="
Add-Type -AssemblyName UIAutomationClient
$racine = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, "Shell_TrayWnd")
$tray = $racine.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
if ($tray) {
  $tous = $tray.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($el in $tous) {
    if ($el.Current.Name -match 'Brave|Chrome|Mistral|YouTube') { "bouton: '$($el.Current.Name)' classe=$($el.Current.ClassName)" }
  }
} else { "Shell_TrayWnd introuvable" }