!include "LogicLib.nsh"
!include "WinMessages.nsh"
!include "nsDialogs.nsh"

!ifdef BUILD_UNINSTALLER
    /* Windows a déjà reçu un clic explicite sur « Désinstaller » : aucun
       assistant supplémentaire. La page INSTFILES reste la vraie source de
       travail, mais tout son chrome NSIS est remplacé visuellement. */
    !define removeDefaultUninstallWelcomePage
    !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.NeoQuizAfficherDesinstallationStylisee
    AutoCloseWindow true

    Var NeoQuizDialogueProgression
    Var NeoQuizBarreTitre
    Var NeoQuizLigneTitre
    Var NeoQuizIconeTitre
    Var NeoQuizMarqueTitre
    Var NeoQuizTexteAttente
    Var NeoQuizPoint0
    Var NeoQuizPoint1
    Var NeoQuizPoint2
    Var NeoQuizPoint3
    Var NeoQuizPoint4
    Var NeoQuizPoint5
    Var NeoQuizPoint6
    Var NeoQuizPoint7
    Var NeoQuizEtapeSpinner
    Var NeoQuizPoliceTitre
    Var NeoQuizPoliceTexte
    Var NeoQuizPolicePoints
    Var NeoQuizPetitIcone

    Function un.NeoQuizAfficherDesinstallationStylisee
        /* Masque tous les éléments du wizard d'electron-builder/NSIS. */
        GetDlgItem $0 $HWNDPARENT 1
        ShowWindow $0 ${SW_HIDE}
        GetDlgItem $0 $HWNDPARENT 2
        ShowWindow $0 ${SW_HIDE}
        GetDlgItem $0 $HWNDPARENT 3
        ShowWindow $0 ${SW_HIDE}
        GetDlgItem $0 $HWNDPARENT 1028
        ShowWindow $0 ${SW_HIDE}
        GetDlgItem $0 $HWNDPARENT 1034
        ShowWindow $0 ${SW_HIDE}
        GetDlgItem $0 $HWNDPARENT 1035
        ShowWindow $0 ${SW_HIDE}
        GetDlgItem $0 $HWNDPARENT 1036
        ShowWindow $0 ${SW_HIDE}
        GetDlgItem $0 $HWNDPARENT 1037
        ShowWindow $0 ${SW_HIDE}
        GetDlgItem $0 $HWNDPARENT 1038
        ShowWindow $0 ${SW_HIDE}
        GetDlgItem $0 $HWNDPARENT 1039
        ShowWindow $0 ${SW_HIDE}
        GetDlgItem $0 $HWNDPARENT 1045
        ShowWindow $0 ${SW_HIDE}
        GetDlgItem $0 $HWNDPARENT 1256
        ShowWindow $0 ${SW_HIDE}

        FindWindow $NeoQuizDialogueProgression "#32770" "" $HWNDPARENT
        ${If} $NeoQuizDialogueProgression == 0
            Return
        ${EndIf}

        GetDlgItem $0 $NeoQuizDialogueProgression 1004
        ShowWindow $0 ${SW_HIDE}
        GetDlgItem $0 $NeoQuizDialogueProgression 1006
        ShowWindow $0 ${SW_HIDE}
        GetDlgItem $0 $NeoQuizDialogueProgression 1027
        ShowWindow $0 ${SW_HIDE}
        GetDlgItem $0 $NeoQuizDialogueProgression 1016
        ShowWindow $0 ${SW_HIDE}

        /* La fenêtre reprend la grammaire de l'installeur Electron : pas de
           barre native claire, une barre Neo Quiz sombre et un corps bleu nuit. */
        SendMessage $HWNDPARENT ${WM_SETTEXT} 0 "STR:${PRODUCT_NAME}"
        System::Call 'user32::GetWindowLongW(p$HWNDPARENT,i-16)i.R7'
        IntOp $R7 $R7 & 0xFF3BFFFF
        System::Call 'user32::SetWindowLongW(p$HWNDPARENT,i-16,i$R7)i.R8'
        System::Call 'user32::SetWindowPos(p$HWNDPARENT,p0,i0,i0,i0,i0,i0x27)'

        System::Call 'user32::GetDpiForWindow(p$HWNDPARENT)i.R0'
        ${If} $R0 <= 0
            StrCpy $R0 96
        ${EndIf}

        IntOp $R1 420 * $R0
        IntOp $R1 $R1 / 96
        IntOp $R2 220 * $R0
        IntOp $R2 $R2 / 96
        System::Call 'user32::GetSystemMetrics(i0)i.R3'
        System::Call 'user32::GetSystemMetrics(i1)i.R4'
        IntOp $R3 $R3 - $R1
        IntOp $R3 $R3 / 2
        IntOp $R4 $R4 - $R2
        IntOp $R4 $R4 / 2
        System::Call 'user32::MoveWindow(p$HWNDPARENT,i$R3,i$R4,i$R1,i$R2,i1)'
        System::Call 'user32::MoveWindow(p$NeoQuizDialogueProgression,i0,i0,i$R1,i$R2,i1)'
        SetCtlColors $NeoQuizDialogueProgression F7F9FF 07101D

        /* Barre supérieure : même duo de couleurs que style-window.css de
           l'installeur (#02060e sur #07101d). */
        IntOp $R3 48 * $R0
        IntOp $R3 $R3 / 96
        System::Call 'user32::CreateWindowExW(i0,w "STATIC",w "",i0x50000000,i0,i0,i$R1,i$R3,p$NeoQuizDialogueProgression,p0,p0,p0)p.R7'
        StrCpy $NeoQuizBarreTitre $R7
        SetCtlColors $NeoQuizBarreTitre F7F9FF 02060E

        IntOp $R4 47 * $R0
        IntOp $R4 $R4 / 96
        IntOp $R5 1 * $R0
        IntOp $R5 $R5 / 96
        ${If} $R5 < 1
            StrCpy $R5 1
        ${EndIf}
        System::Call 'user32::CreateWindowExW(i0,w "STATIC",w "",i0x50000000,i0,i$R4,i$R1,i$R5,p$NeoQuizDialogueProgression,p0,p0,p0)p.R7'
        StrCpy $NeoQuizLigneTitre $R7
        SetCtlColors $NeoQuizLigneTitre F7F9FF 13213B

        /* Réutilise l'icône réellement embarquée dans le désinstalleur. */
        System::Call 'shell32::ExtractIconExW(w "$EXEPATH",i0,*p.R7,*p.R8,i1)i.R9'
        StrCpy $NeoQuizPetitIcone $R8
        IntOp $R3 16 * $R0
        IntOp $R3 $R3 / 96
        IntOp $R4 12 * $R0
        IntOp $R4 $R4 / 96
        IntOp $R5 24 * $R0
        IntOp $R5 $R5 / 96
        System::Call 'user32::CreateWindowExW(i0,w "STATIC",w "",i0x50000003,i$R3,i$R4,i$R5,i$R5,p$NeoQuizDialogueProgression,p0,p0,p0)p.R7'
        StrCpy $NeoQuizIconeTitre $R7
        ${If} $NeoQuizPetitIcone != 0
            SendMessage $NeoQuizIconeTitre 0x0172 1 $NeoQuizPetitIcone
        ${EndIf}

        IntOp $R3 48 * $R0
        IntOp $R3 $R3 / 96
        IntOp $R4 8 * $R0
        IntOp $R4 $R4 / 96
        IntOp $R5 160 * $R0
        IntOp $R5 $R5 / 96
        IntOp $R6 32 * $R0
        IntOp $R6 $R6 / 96
        System::Call 'user32::CreateWindowExW(i0,w "STATIC",w "Neo Quiz",i0x50000200,i$R3,i$R4,i$R5,i$R6,p$NeoQuizDialogueProgression,p0,p0,p0)p.R7'
        StrCpy $NeoQuizMarqueTitre $R7
        SetCtlColors $NeoQuizMarqueTitre F7F9FF 02060E

        System::Call 'gdi32::CreateFontW(i15,i0,i0,i0,i600,i0,i0,i0,i1,i0,i0,i0,i0,w "Segoe UI Variable Text")p.R7'
        StrCpy $NeoQuizPoliceTitre $R7
        SendMessage $NeoQuizMarqueTitre ${WM_SETFONT} $NeoQuizPoliceTitre 1

        /* Vrai spinner visuel : huit points indépendants autour d'un cercle.
           Aucun glyphe demi-cercle n'est utilisé, donc le rendu ne dépend plus
           de l'interprétation de ◐/◓/◑/◒ par la police Windows. */
        System::Call 'gdi32::CreateFontW(i17,i0,i0,i0,i600,i0,i0,i0,i1,i0,i0,i0,i0,w "Segoe UI Symbol")p.R7'
        StrCpy $NeoQuizPolicePoints $R7

        IntOp $R5 18 * $R0
        IntOp $R5 $R5 / 96
        IntOp $R6 18 * $R0
        IntOp $R6 $R6 / 96

        IntOp $R3 201 * $R0
        IntOp $R3 $R3 / 96
        IntOp $R4 70 * $R0
        IntOp $R4 $R4 / 96
        System::Call 'user32::CreateWindowExW(i0,w "STATIC",w "•",i0x50000201,i$R3,i$R4,i$R5,i$R6,p$NeoQuizDialogueProgression,p0,p0,p0)p.R7'
        StrCpy $NeoQuizPoint0 $R7

        IntOp $R3 222 * $R0
        IntOp $R3 $R3 / 96
        IntOp $R4 78 * $R0
        IntOp $R4 $R4 / 96
        System::Call 'user32::CreateWindowExW(i0,w "STATIC",w "•",i0x50000201,i$R3,i$R4,i$R5,i$R6,p$NeoQuizDialogueProgression,p0,p0,p0)p.R7'
        StrCpy $NeoQuizPoint1 $R7

        IntOp $R3 230 * $R0
        IntOp $R3 $R3 / 96
        IntOp $R4 99 * $R0
        IntOp $R4 $R4 / 96
        System::Call 'user32::CreateWindowExW(i0,w "STATIC",w "•",i0x50000201,i$R3,i$R4,i$R5,i$R6,p$NeoQuizDialogueProgression,p0,p0,p0)p.R7'
        StrCpy $NeoQuizPoint2 $R7

        IntOp $R3 222 * $R0
        IntOp $R3 $R3 / 96
        IntOp $R4 120 * $R0
        IntOp $R4 $R4 / 96
        System::Call 'user32::CreateWindowExW(i0,w "STATIC",w "•",i0x50000201,i$R3,i$R4,i$R5,i$R6,p$NeoQuizDialogueProgression,p0,p0,p0)p.R7'
        StrCpy $NeoQuizPoint3 $R7

        IntOp $R3 201 * $R0
        IntOp $R3 $R3 / 96
        IntOp $R4 128 * $R0
        IntOp $R4 $R4 / 96
        System::Call 'user32::CreateWindowExW(i0,w "STATIC",w "•",i0x50000201,i$R3,i$R4,i$R5,i$R6,p$NeoQuizDialogueProgression,p0,p0,p0)p.R7'
        StrCpy $NeoQuizPoint4 $R7

        IntOp $R3 180 * $R0
        IntOp $R3 $R3 / 96
        IntOp $R4 120 * $R0
        IntOp $R4 $R4 / 96
        System::Call 'user32::CreateWindowExW(i0,w "STATIC",w "•",i0x50000201,i$R3,i$R4,i$R5,i$R6,p$NeoQuizDialogueProgression,p0,p0,p0)p.R7'
        StrCpy $NeoQuizPoint5 $R7

        IntOp $R3 172 * $R0
        IntOp $R3 $R3 / 96
        IntOp $R4 99 * $R0
        IntOp $R4 $R4 / 96
        System::Call 'user32::CreateWindowExW(i0,w "STATIC",w "•",i0x50000201,i$R3,i$R4,i$R5,i$R6,p$NeoQuizDialogueProgression,p0,p0,p0)p.R7'
        StrCpy $NeoQuizPoint6 $R7

        IntOp $R3 180 * $R0
        IntOp $R3 $R3 / 96
        IntOp $R4 78 * $R0
        IntOp $R4 $R4 / 96
        System::Call 'user32::CreateWindowExW(i0,w "STATIC",w "•",i0x50000201,i$R3,i$R4,i$R5,i$R6,p$NeoQuizDialogueProgression,p0,p0,p0)p.R7'
        StrCpy $NeoQuizPoint7 $R7

        SendMessage $NeoQuizPoint0 ${WM_SETFONT} $NeoQuizPolicePoints 1
        SendMessage $NeoQuizPoint1 ${WM_SETFONT} $NeoQuizPolicePoints 1
        SendMessage $NeoQuizPoint2 ${WM_SETFONT} $NeoQuizPolicePoints 1
        SendMessage $NeoQuizPoint3 ${WM_SETFONT} $NeoQuizPolicePoints 1
        SendMessage $NeoQuizPoint4 ${WM_SETFONT} $NeoQuizPolicePoints 1
        SendMessage $NeoQuizPoint5 ${WM_SETFONT} $NeoQuizPolicePoints 1
        SendMessage $NeoQuizPoint6 ${WM_SETFONT} $NeoQuizPolicePoints 1
        SendMessage $NeoQuizPoint7 ${WM_SETFONT} $NeoQuizPolicePoints 1

        IntOp $R3 40 * $R0
        IntOp $R3 $R3 / 96
        IntOp $R4 160 * $R0
        IntOp $R4 $R4 / 96
        IntOp $R5 340 * $R0
        IntOp $R5 $R5 / 96
        IntOp $R6 30 * $R0
        IntOp $R6 $R6 / 96

        System::Call 'kernel32::GetUserDefaultUILanguage()i.R7'
        IntOp $R7 $R7 & 0x3FF
        ${If} $R7 == 12
            StrCpy $R8 "Désinstallation en cours..."
        ${Else}
            StrCpy $R8 "Uninstalling Neo Quiz..."
        ${EndIf}
        System::Call 'user32::CreateWindowExW(i0,w "STATIC",w "$R8",i0x50000201,i$R3,i$R4,i$R5,i$R6,p$NeoQuizDialogueProgression,p0,p0,p0)p.R7'
        StrCpy $NeoQuizTexteAttente $R7
        SetCtlColors $NeoQuizTexteAttente C6D0F5 07101D
        System::Call 'gdi32::CreateFontW(i16,i0,i0,i0,i500,i0,i0,i0,i1,i0,i0,i0,i0,w "Segoe UI Variable Text")p.R7'
        StrCpy $NeoQuizPoliceTexte $R7
        SendMessage $NeoQuizTexteAttente ${WM_SETFONT} $NeoQuizPoliceTexte 1

        StrCpy $NeoQuizEtapeSpinner 0
        ${NSD_CreateTimer} un.NeoQuizAnimerSpinner 90
        Call un.NeoQuizAnimerSpinner
    FunctionEnd

    Function un.NeoQuizAnimerSpinner
        ${If} $NeoQuizPoint0 == 0
            Return
        ${EndIf}

        /* Tous les points restent visibles, mais un seul est lumineux. Le
           mouvement est donc circulaire et stable à n'importe quel DPI. */
        SetCtlColors $NeoQuizPoint0 52607F 07101D
        SetCtlColors $NeoQuizPoint1 52607F 07101D
        SetCtlColors $NeoQuizPoint2 52607F 07101D
        SetCtlColors $NeoQuizPoint3 52607F 07101D
        SetCtlColors $NeoQuizPoint4 52607F 07101D
        SetCtlColors $NeoQuizPoint5 52607F 07101D
        SetCtlColors $NeoQuizPoint6 52607F 07101D
        SetCtlColors $NeoQuizPoint7 52607F 07101D

        ${If} $NeoQuizEtapeSpinner == 0
            SetCtlColors $NeoQuizPoint0 5B9DFF 07101D
        ${ElseIf} $NeoQuizEtapeSpinner == 1
            SetCtlColors $NeoQuizPoint1 5B9DFF 07101D
        ${ElseIf} $NeoQuizEtapeSpinner == 2
            SetCtlColors $NeoQuizPoint2 5B9DFF 07101D
        ${ElseIf} $NeoQuizEtapeSpinner == 3
            SetCtlColors $NeoQuizPoint3 5B9DFF 07101D
        ${ElseIf} $NeoQuizEtapeSpinner == 4
            SetCtlColors $NeoQuizPoint4 5B9DFF 07101D
        ${ElseIf} $NeoQuizEtapeSpinner == 5
            SetCtlColors $NeoQuizPoint5 5B9DFF 07101D
        ${ElseIf} $NeoQuizEtapeSpinner == 6
            SetCtlColors $NeoQuizPoint6 5B9DFF 07101D
        ${Else}
            SetCtlColors $NeoQuizPoint7 5B9DFF 07101D
        ${EndIf}

        IntOp $NeoQuizEtapeSpinner $NeoQuizEtapeSpinner + 1
        ${If} $NeoQuizEtapeSpinner > 7
            StrCpy $NeoQuizEtapeSpinner 0
        ${EndIf}
    FunctionEnd

    !macro customUnInstall
        /* Rien de technique ne doit remplacer l'état visuel pendant que les
           fichiers sont supprimés. */
        SetDetailsPrint listonly
    !macroend

    Function un.NeoQuizIgnorerPageFinale
        ${NSD_KillTimer} un.NeoQuizAnimerSpinner
        Abort
    FunctionEnd

    !macro customUninstallPage
        /* Pas de page « Terminé » : disparition automatique dès que la vraie
           désinstallation est finie. */
        !define MUI_PAGE_CUSTOMFUNCTION_PRE un.NeoQuizIgnorerPageFinale
    !macroend
!endif
