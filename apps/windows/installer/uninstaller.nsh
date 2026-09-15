!include "LogicLib.nsh"
!include "WinMessages.nsh"
!include "nsDialogs.nsh"

!ifdef BUILD_UNINSTALLER
    /* Windows a déjà reçu un clic explicite sur « Désinstaller » : pas
       d'assistant ni de confirmation supplémentaire. */
    !define removeDefaultUninstallWelcomePage
    !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.NeoQuizAfficherDesinstallationCompacte
    AutoCloseWindow true

    Var NeoQuizDialogueProgression
    Var NeoQuizSpinner
    Var NeoQuizTexteAttente
    Var NeoQuizEtapeSpinner
    Var NeoQuizPoliceSpinner
    Var NeoQuizPoliceTexte

    Function un.NeoQuizAfficherDesinstallationCompacte
        SendMessage $HWNDPARENT ${WM_SETTEXT} 0 "STR:${PRODUCT_NAME}"

        /* Cache tout le chrome NSIS : boutons, en-tête, séparateurs, marque,
           détails, barre native et texte de progression. La désinstallation
           continue normalement en arrière-plan, mais l'utilisateur ne voit
           qu'une petite fenêtre d'attente cohérente avec le lancement de Neo Quiz. */
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

        /* Petite fenêtre indépendante, centrée, sombre comme l'état
           « Ouverture de Neo Quiz… ». Toutes les mesures suivent le DPI réel. */
        System::Call 'user32::GetDpiForWindow(p$HWNDPARENT)i.R0'
        ${If} $R0 <= 0
            StrCpy $R0 96
        ${EndIf}

        IntOp $R1 360 * $R0
        IntOp $R1 $R1 / 96
        IntOp $R2 180 * $R0
        IntOp $R2 $R2 / 96
        System::Call 'user32::GetSystemMetrics(i0)i.R3'
        System::Call 'user32::GetSystemMetrics(i1)i.R4'
        IntOp $R3 $R3 - $R1
        IntOp $R3 $R3 / 2
        IntOp $R4 $R4 - $R2
        IntOp $R4 $R4 / 2
        System::Call 'user32::MoveWindow(p$HWNDPARENT,i$R3,i$R4,i$R1,i$R2,i1)'

        IntOp $R3 360 * $R0
        IntOp $R3 $R3 / 96
        IntOp $R4 150 * $R0
        IntOp $R4 $R4 / 96
        System::Call 'user32::MoveWindow(p$NeoQuizDialogueProgression,i0,i0,i$R3,i$R4,i1)'
        SetCtlColors $NeoQuizDialogueProgression FFFFFF 202124

        /* Spinner circulaire texte, volontairement indépendant de la vraie
           progression : la désinstallation est très courte et n'a pas besoin
           d'inventer un pourcentage. */
        IntOp $R3 145 * $R0
        IntOp $R3 $R3 / 96
        IntOp $R4 28 * $R0
        IntOp $R4 $R4 / 96
        IntOp $R5 70 * $R0
        IntOp $R5 $R5 / 96
        IntOp $R6 54 * $R0
        IntOp $R6 $R6 / 96
        System::Call 'user32::CreateWindowExW(i0,w "STATIC",w "◐",i0x50000201,i$R3,i$R4,i$R5,i$R6,p$NeoQuizDialogueProgression,p0,p0,p0)p.R7'
        StrCpy $NeoQuizSpinner $R7
        SetCtlColors $NeoQuizSpinner F7F9FF 202124

        IntOp $R3 30 * $R0
        IntOp $R3 $R3 / 96
        IntOp $R4 92 * $R0
        IntOp $R4 $R4 / 96
        IntOp $R5 300 * $R0
        IntOp $R5 $R5 / 96
        IntOp $R6 30 * $R0
        IntOp $R6 $R6 / 96
        System::Call 'user32::CreateWindowExW(i0,w "STATIC",w "Désinstallation en cours...",i0x50000201,i$R3,i$R4,i$R5,i$R6,p$NeoQuizDialogueProgression,p0,p0,p0)p.R7'
        StrCpy $NeoQuizTexteAttente $R7
        SetCtlColors $NeoQuizTexteAttente F7F9FF 202124

        /* Deux fontes simples Segoe UI pour retrouver le poids visuel de la
           fenêtre de lancement sans embarquer d'asset supplémentaire. */
        System::Call 'gdi32::CreateFontW(i34,i0,i0,i0,i400,i0,i0,i0,i1,i0,i0,i0,i0,w "Segoe UI Symbol")p.R7'
        StrCpy $NeoQuizPoliceSpinner $R7
        SendMessage $NeoQuizSpinner ${WM_SETFONT} $NeoQuizPoliceSpinner 1

        System::Call 'gdi32::CreateFontW(i16,i0,i0,i0,i500,i0,i0,i0,i1,i0,i0,i0,i0,w "Segoe UI")p.R7'
        StrCpy $NeoQuizPoliceTexte $R7
        SendMessage $NeoQuizTexteAttente ${WM_SETFONT} $NeoQuizPoliceTexte 1

        StrCpy $NeoQuizEtapeSpinner 0
        ${NSD_CreateTimer} un.NeoQuizAnimerSpinner 90
        Call un.NeoQuizAnimerSpinner
    FunctionEnd

    Function un.NeoQuizAnimerSpinner
        ${If} $NeoQuizSpinner == 0
            Return
        ${EndIf}

        IntOp $NeoQuizEtapeSpinner $NeoQuizEtapeSpinner + 1
        ${If} $NeoQuizEtapeSpinner > 3
            StrCpy $NeoQuizEtapeSpinner 0
        ${EndIf}

        ${If} $NeoQuizEtapeSpinner == 0
            StrCpy $R0 "◐"
        ${ElseIf} $NeoQuizEtapeSpinner == 1
            StrCpy $R0 "◓"
        ${ElseIf} $NeoQuizEtapeSpinner == 2
            StrCpy $R0 "◑"
        ${Else}
            StrCpy $R0 "◒"
        ${EndIf}
        SendMessage $NeoQuizSpinner ${WM_SETTEXT} 0 "STR:$R0"
    FunctionEnd

    !macro customUnInstall
        SetDetailsPrint listonly
    !macroend

    Function un.NeoQuizIgnorerPageFinale
        ${NSD_KillTimer} un.NeoQuizAnimerSpinner
        Abort
    FunctionEnd

    !macro customUninstallPage
        /* Pas de page « Terminé » : la fenêtre se ferme automatiquement dès
           que NSIS a réellement fini de supprimer l'application. */
        !define MUI_PAGE_CUSTOMFUNCTION_PRE un.NeoQuizIgnorerPageFinale
    !macroend
!endif
