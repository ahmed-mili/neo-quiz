!include "LogicLib.nsh"
!include "WinMessages.nsh"
!include "nsDialogs.nsh"

!ifdef BUILD_UNINSTALLER
    /* Aucun écran de bienvenue : Windows a déjà reçu un clic explicite sur
       « Désinstaller ». Le mode assisté reste volontairement actif pour ne pas
       afficher la boîte de confirmation imposée par le mode ONE_CLICK. */
    !define removeDefaultUninstallWelcomePage
    /* `perMachine: true` fait de la page INSTFILES la première page du
       désinstalleur. Ce callback MUI est donc le point fiable où les contrôles
       existent réellement : pas de timer qui tente de les deviner trop tôt. */
    !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.NeoQuizAfficherDesinstallationCompacte
    AutoCloseWindow true

    Var NeoQuizDialogueProgression
    Var NeoQuizBarreProgression
    Var NeoQuizTexteProgression

    Function un.NeoQuizAfficherDesinstallationCompacte
        SendMessage $HWNDPARENT ${WM_SETTEXT} 0 "STR:${PRODUCT_NAME}"

        /* Cache tout le chrome du wizard : boutons, en-tête, séparateurs,
           marque/version et zone de détails. Il ne reste que la fenêtre native
           Windows, la barre et le pourcentage. */
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
        GetDlgItem $NeoQuizBarreProgression $NeoQuizDialogueProgression 1004
        GetDlgItem $NeoQuizTexteProgression $NeoQuizDialogueProgression 1006
        GetDlgItem $0 $NeoQuizDialogueProgression 1027
        ShowWindow $0 ${SW_HIDE}
        GetDlgItem $0 $NeoQuizDialogueProgression 1016
        ShowWindow $0 ${SW_HIDE}

        /* Même ordre de grandeur que la petite fenêtre Google Play Games de
           référence. Tout est converti avec le DPI réel de la fenêtre. */
        System::Call 'user32::GetDpiForWindow(p$HWNDPARENT)i.R0'
        ${If} $R0 <= 0
            StrCpy $R0 96
        ${EndIf}
        IntOp $R1 320 * $R0
        IntOp $R1 $R1 / 96
        IntOp $R2 104 * $R0
        IntOp $R2 $R2 / 96
        System::Call 'user32::GetSystemMetrics(i0)i.R3'
        System::Call 'user32::GetSystemMetrics(i1)i.R4'
        IntOp $R3 $R3 - $R1
        IntOp $R3 $R3 / 2
        IntOp $R4 $R4 - $R2
        IntOp $R4 $R4 / 2
        System::Call 'user32::MoveWindow(p$HWNDPARENT,i$R3,i$R4,i$R1,i$R2,i1)'

        /* La page remplit le client. Barre à gauche, pourcentage court à
           droite : aucun texte de statut ou bouton ne réapparaît. */
        IntOp $R3 320 * $R0
        IntOp $R3 $R3 / 96
        IntOp $R4 74 * $R0
        IntOp $R4 $R4 / 96
        System::Call 'user32::MoveWindow(p$NeoQuizDialogueProgression,i0,i0,i$R3,i$R4,i1)'

        IntOp $R3 26 * $R0
        IntOp $R3 $R3 / 96
        IntOp $R4 28 * $R0
        IntOp $R4 $R4 / 96
        IntOp $R5 230 * $R0
        IntOp $R5 $R5 / 96
        IntOp $R6 12 * $R0
        IntOp $R6 $R6 / 96
        System::Call 'user32::MoveWindow(p$NeoQuizBarreProgression,i$R3,i$R4,i$R5,i$R6,i1)'

        IntOp $R3 262 * $R0
        IntOp $R3 $R3 / 96
        IntOp $R4 22 * $R0
        IntOp $R4 $R4 / 96
        IntOp $R5 46 * $R0
        IntOp $R5 $R5 / 96
        IntOp $R6 24 * $R0
        IntOp $R6 $R6 / 96
        System::Call 'user32::MoveWindow(p$NeoQuizTexteProgression,i$R3,i$R4,i$R5,i$R6,i1)'
        System::Call 'user32::GetWindowLong(p$NeoQuizTexteProgression,i${GWL_STYLE})i.R7'
        IntOp $R7 $R7 & 0xFFFFFFE0
        IntOp $R7 $R7 | ${SS_CENTER}
        IntOp $R7 $R7 | ${SS_CENTERIMAGE}
        System::Call 'user32::SetWindowLong(p$NeoQuizTexteProgression,i${GWL_STYLE},i$R7)'
        ShowWindow $NeoQuizTexteProgression ${SW_SHOW}

        ${NSD_CreateTimer} un.NeoQuizRafraichirDesinstallation 40
        Call un.NeoQuizRafraichirDesinstallation
    FunctionEnd

    Function un.NeoQuizRafraichirDesinstallation
        ${If} $NeoQuizBarreProgression == 0
            Return
        ${EndIf}
        SendMessage $NeoQuizBarreProgression ${PBM_GETRANGE} 0 0 $R0
        SendMessage $NeoQuizBarreProgression ${PBM_GETPOS} 0 0 $R1
        ${If} $R0 > 0
            IntOp $R2 $R1 * 100
            IntOp $R2 $R2 / $R0
        ${Else}
            StrCpy $R2 0
        ${EndIf}
        ${If} $R2 < 0
            StrCpy $R2 0
        ${ElseIf} $R2 > 100
            StrCpy $R2 100
        ${EndIf}
        SendMessage $NeoQuizTexteProgression ${WM_SETTEXT} 0 "STR:$R2%"
    FunctionEnd

    !macro customUnInstall
        /* Empêche DetailPrint de remplacer le pourcentage par des noms de
           fichiers pendant la suppression. */
        SetDetailsPrint listonly
    !macroend

    Function un.NeoQuizIgnorerPageFinale
        ${NSD_KillTimer} un.NeoQuizRafraichirDesinstallation
        Abort
    FunctionEnd

    !macro customUninstallPage
        /* Pas de page « Terminé » : la petite fenêtre se ferme seule à 100 %. */
        !define MUI_PAGE_CUSTOMFUNCTION_PRE un.NeoQuizIgnorerPageFinale
    !macroend
!endif
