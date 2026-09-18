# MESURE (ne vérifie rien) : la plus longue URL que ShellExecute accepte
# de passer au navigateur par défaut. C'est le chemin de shell.openExternal
# (Electron, Windows), donc la borne de « ouvrir claude.ai avec la question
# dans l'adresse ». Voir la spec 2026-09-18-generation-web-design.md, §0.
#
#     npm run report:url-max
#
# Ouvre quelques onglets https://example.com/ (les essais admis) : c'est le
# prix de la mesure, et example.com ne fait rien de ce qu'on lui envoie.
$ErrorActionPreference = "Stop"
$base = "https://example.com/?q="
function Essai([int]$longueur) {
    $q = "a" * ($longueur - $base.Length)
    try { Start-Process ($base + $q); return $true } catch { return $false }
}
$bas = 8000; $haut = 70000
if (-not (Essai $bas)) { Write-Output "Même $bas caractères sont refusés : mesure impossible"; exit 0 }
if (Essai $haut) { Write-Output "$haut caractères passent : la borne est au-delà de la plage mesurée"; exit 0 }
while ($haut - $bas -gt 64) {
    $milieu = [int](($bas + $haut) / 2)
    if (Essai $milieu) { $bas = $milieu } else { $haut = $milieu }
    Start-Sleep -Milliseconds 300
}
Write-Output "Plus longue URL admise par ShellExecute : entre $bas et $haut caractères"
