from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str, marker: str) -> None:
    p = ROOT / path
    s = p.read_text(encoding="utf-8")
    if marker in s:
        return
    if s.count(old) != 1:
        raise SystemExit(f"{path}: motif unique introuvable pour {marker!r}")
    p.write_text(s.replace(old, new, 1), encoding="utf-8")


# La barre native NSIS dépend du thème Windows et ne ressemble pas à la barre
# plate de la référence. On la garde uniquement comme SOURCE de progression :
# elle reste cachée, tandis que deux STATIC sans bordure dessinent la piste et
# le remplissage avec les dimensions/couleurs voulues.
replace_once(
    "apps/windows/installer/uninstaller.nsh",
    "    Var NeoQuizDialogueProgression\n    Var NeoQuizBarreProgression\n    Var NeoQuizTexteProgression\n",
    "    Var NeoQuizDialogueProgression\n    Var NeoQuizBarreProgression\n    Var NeoQuizTexteProgression\n    Var NeoQuizPisteProgression\n    Var NeoQuizRemplissageProgression\n    Var NeoQuizBarreX\n    Var NeoQuizBarreY\n    Var NeoQuizBarreLargeur\n    Var NeoQuizBarreHauteur\n",
    "Var NeoQuizPisteProgression",
)

replace_once(
    "apps/windows/installer/uninstaller.nsh",
    "        GetDlgItem $NeoQuizBarreProgression $NeoQuizDialogueProgression 1004\n        GetDlgItem $NeoQuizTexteProgression $NeoQuizDialogueProgression 1006\n",
    "        GetDlgItem $NeoQuizBarreProgression $NeoQuizDialogueProgression 1004\n        GetDlgItem $NeoQuizTexteProgression $NeoQuizDialogueProgression 1006\n        /* La barre système reste vivante pour que PBM_GETPOS reflète la vraie\n           suppression, mais elle ne doit jamais être peinte : son relief, sa\n           hauteur et ses couleurs changent selon le thème Windows. */\n        ShowWindow $NeoQuizBarreProgression ${SW_HIDE}\n",
    "La barre système reste vivante pour que PBM_GETPOS",
)

replace_once(
    "apps/windows/installer/uninstaller.nsh",
    "        IntOp $R3 26 * $R0\n        IntOp $R3 $R3 / 96\n        IntOp $R4 28 * $R0\n        IntOp $R4 $R4 / 96\n        IntOp $R5 230 * $R0\n        IntOp $R5 $R5 / 96\n        IntOp $R6 12 * $R0\n        IntOp $R6 $R6 / 96\n        System::Call 'user32::MoveWindow(p$NeoQuizBarreProgression,i$R3,i$R4,i$R5,i$R6,i1)'\n",
    "        /* Barre linéaire plate, fidèle à la référence Google Play Games :\n           même centre que l'ancienne barre, mais seulement 4 px de haut, une\n           piste gris clair et un remplissage Google blue. Aucun relief natif. */\n        IntOp $NeoQuizBarreX 26 * $R0\n        IntOp $NeoQuizBarreX $NeoQuizBarreX / 96\n        IntOp $NeoQuizBarreY 32 * $R0\n        IntOp $NeoQuizBarreY $NeoQuizBarreY / 96\n        IntOp $NeoQuizBarreLargeur 230 * $R0\n        IntOp $NeoQuizBarreLargeur $NeoQuizBarreLargeur / 96\n        IntOp $NeoQuizBarreHauteur 4 * $R0\n        IntOp $NeoQuizBarreHauteur $NeoQuizBarreHauteur / 96\n        ${If} $NeoQuizBarreHauteur < 2\n            StrCpy $NeoQuizBarreHauteur 2\n        ${EndIf}\n\n        System::Call 'user32::CreateWindowExW(i0,w \"STATIC\",w \"\",i0x50000000,i$NeoQuizBarreX,i$NeoQuizBarreY,i$NeoQuizBarreLargeur,i$NeoQuizBarreHauteur,p$NeoQuizDialogueProgression,p0,p0,p0)p.R3'\n        StrCpy $NeoQuizPisteProgression $R3\n        SetCtlColors $NeoQuizPisteProgression 000000 DADCE0\n\n        /* Largeur initiale minimale : la première lecture PBM_GETPOS ci-dessous\n           la masque réellement si la progression vaut encore 0 %. */\n        System::Call 'user32::CreateWindowExW(i0,w \"STATIC\",w \"\",i0x50000000,i$NeoQuizBarreX,i$NeoQuizBarreY,i1,i$NeoQuizBarreHauteur,p$NeoQuizDialogueProgression,p0,p0,p0)p.R3'\n        StrCpy $NeoQuizRemplissageProgression $R3\n        SetCtlColors $NeoQuizRemplissageProgression 000000 1A73E8\n",
    "Barre linéaire plate, fidèle à la référence Google Play Games",
)

replace_once(
    "apps/windows/installer/uninstaller.nsh",
    "        SendMessage $NeoQuizTexteProgression ${WM_SETTEXT} 0 \"STR:$R2%\"\n",
    "        ${If} $NeoQuizRemplissageProgression != 0\n            IntOp $R3 $NeoQuizBarreLargeur * $R2\n            IntOp $R3 $R3 / 100\n            ${If} $R3 <= 0\n                ShowWindow $NeoQuizRemplissageProgression ${SW_HIDE}\n            ${Else}\n                System::Call 'user32::MoveWindow(p$NeoQuizRemplissageProgression,i$NeoQuizBarreX,i$NeoQuizBarreY,i$R3,i$NeoQuizBarreHauteur,i1)'\n                ShowWindow $NeoQuizRemplissageProgression ${SW_SHOW}\n            ${EndIf}\n        ${EndIf}\n        SendMessage $NeoQuizTexteProgression ${WM_SETTEXT} 0 \"STR:$R2%\"\n",
    "IntOp $R3 $NeoQuizBarreLargeur * $R2",
)

old_check = '''r.check("désinstallation : petite fenêtre directe avec progression et pourcentage",
\t[
\t\tconfig.nsis?.oneClick,
\t\tconfig.nsis?.perMachine,
\t\tuninstallerNsis.includes("removeDefaultUninstallWelcomePage"),
\t\tuninstallerNsis.includes("MUI_PAGE_CUSTOMFUNCTION_SHOW un.NeoQuizAfficherDesinstallationCompacte"),
\t\tuninstallerNsis.includes("PBM_GETPOS"),
\t\tuninstallerNsis.includes('"STR:$R2%"'),
\t],
\t[false, true, true, true, true, true]);'''
new_check = '''r.check("désinstallation : barre plate fidèle avec progression et pourcentage",
\t[
\t\tconfig.nsis?.oneClick,
\t\tconfig.nsis?.perMachine,
\t\tuninstallerNsis.includes("removeDefaultUninstallWelcomePage"),
\t\tuninstallerNsis.includes("MUI_PAGE_CUSTOMFUNCTION_SHOW un.NeoQuizAfficherDesinstallationCompacte"),
\t\tuninstallerNsis.includes("PBM_GETPOS"),
\t\tuninstallerNsis.includes("ShowWindow $NeoQuizBarreProgression ${SW_HIDE}"),
\t\tuninstallerNsis.includes("SetCtlColors $NeoQuizPisteProgression 000000 DADCE0"),
\t\tuninstallerNsis.includes("SetCtlColors $NeoQuizRemplissageProgression 000000 1A73E8"),
\t\tuninstallerNsis.includes("IntOp $R3 $NeoQuizBarreLargeur * $R2"),
\t\tuninstallerNsis.includes('"STR:$R2%"'),
\t],
\t[false, true, true, true, true, true, true, true, true, true]);'''
replace_once(
    "scripts/check-package.mjs",
    old_check,
    new_check,
    'r.check("désinstallation : barre plate fidèle avec progression et pourcentage"',
)
