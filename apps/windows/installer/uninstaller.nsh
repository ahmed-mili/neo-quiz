!include "LogicLib.nsh"
!include "WinMessages.nsh"
!include "nsDialogs.nsh"

!ifdef BUILD_UNINSTALLER
    /* Windows a déjà reçu un clic explicite sur « Désinstaller » : aucun
       assistant ni confirmation supplémentaire. La page INSTFILES reste le
       moteur réel, mais son interface native est entièrement masquée. */
    !define removeDefaultUninstallWelcomePage
    !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.NeoQuizAfficherDesinstallationStylisee
    AutoCloseWindow true

    Var NeoQuizDialogueProgression
    Var NeoQuizProgressionNative
    Var NeoQuizBarreTitre
    Var NeoQuizLigneTitre
    Var NeoQuizIconeTitre
    Var NeoQuizMarqueTitre
    Var NeoQuizTexteAttente
    Var NeoQuizPisteProgression
    Var NeoQuizRemplissageProgression
    Var NeoQuizBarreX
    Var NeoQuizBarreY
    Var NeoQuizBarreLargeur
    Var NeoQuizBarreHauteur
    Var NeoQuizPoliceTitre
    Var NeoQuizPoliceTexte
    Var NeoQuizPetitIcone

    Function un.NeoQuizAfficherDesinstallationStylisee
        /* Tout le wizard NSIS disparaît : l'utilisateur ne voit que notre
           petite fenêtre Neo Quiz, le texte et la vraie progression. */
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

        /* La barre système reste vivante mais invisible. Elle est uniquement
           notre source de vérité pour PBM_GETPOS : aucune progression fictive. */
        GetDlgItem $NeoQuizProgressionNative $NeoQuizDialogueProgression 1004
        ShowWindow $NeoQuizProgressionNative ${SW_HIDE}
        GetDlgItem $0 $NeoQuizDialogueProgression 1006
        ShowWindow $0 ${SW_HIDE}
        GetDlgItem $0 $NeoQuizDialogueProgression 1027
        ShowWindow $0 ${SW_HIDE}
        GetDlgItem $0 $NeoQuizDialogueProgression 1016
        ShowWindow $0 ${SW_HIDE}

        /* Même logique visuelle que l'installeur : fenêtre compacte sans chrome
           Windows clair, barre de titre bleu-noir et corps uni bleu nuit. */
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
        IntOp $R2 170 * $R0
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

        /* Coins adoucis comme l'installeur, sans reprendre son illustration de
           fond : ici le fond reste volontairement uni et calme. */
        IntOp $R9 14 * $R0
        IntOp $R9 $R9 / 96
        System::Call 'gdi32::CreateRoundRectRgn(i0,i0,i$R1,i$R2,i$R9,i$R9)p.R7'
        ${If} $R7 != 0
            System::Call 'user32::SetWindowRgn(p$HWNDPARENT,p$R7,i1)i.R8'
        ${EndIf}

        /* Barre de titre sombre, identique en palette à l'installeur. */
        IntOp $R3 42 * $R0
        IntOp $R3 $R3 / 96
        System::Call 'user32::CreateWindowExW(i0,w "STATIC",w "",i0x50000000,i0,i0,i$R1,i$R3,p$NeoQuizDialogueProgression,p0,p0,p0)p.R7'
        StrCpy $NeoQuizBarreTitre $R7
        SetCtlColors $NeoQuizBarreTitre F7F9FF 02060E

        IntOp $R4 41 * $R0
        IntOp $R4 $R4 / 96
        StrCpy $R5 1
        System::Call 'user32::CreateWindowExW(i0,w "STATIC",w "",i0x50000000,i0,i$R4,i$R1,i$R5,p$NeoQuizDialogueProgression,p0,p0,p0)p.R7'
        StrCpy $NeoQuizLigneTitre $R7
        SetCtlColors $NeoQuizLigneTitre F7F9FF 13213B

        /* Icône et marque Neo Quiz, discrètes comme dans la barre supérieure de
           l'installeur. */
        System::Call 'shell32::ExtractIconExW(w "$EXEPATH",i0,*p.R7,*p.R8,i1)i.R9'
        StrCpy $NeoQuizPetitIcone $R8
        IntOp $R3 14 * $R0
        IntOp $R3 $R3 / 96
        IntOp $R4 9 * $R0
        IntOp $R4 $R4 / 96
        IntOp $R5 24 * $R0
        IntOp $R5 $R5 / 96
        System::Call 'user32::CreateWindowExW(i0,w "STATIC",w "",i0x50000003,i$R3,i$R4,i$R5,i$R5,p$NeoQuizDialogueProgression,p0,p0,p0)p.R7'
        StrCpy $NeoQuizIconeTitre $R7
        ${If} $NeoQuizPetitIcone != 0
            SendMessage $NeoQuizIconeTitre 0x0172 1 $NeoQuizPetitIcone
        ${EndIf}

        IntOp $R3 46 * $R0
        IntOp $R3 $R3 / 96
        IntOp $R4 5 * $R0
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

        /* Seul texte fonctionnel : « Désinstallation en cours... ». */
        System::Call 'kernel32::GetUserDefaultUILanguage()i.R7'
        IntOp $R7 $R7 & 0x3FF
        ${If} $R7 == 12
            StrCpy $R8 "Désinstallation en cours..."
        ${Else}
            StrCpy $R8 "Uninstalling Neo Quiz..."
        ${EndIf}
        IntOp $R3 40 * $R0
        IntOp $R3 $R3 / 96
        IntOp $R4 70 * $R0
        IntOp $R4 $R4 / 96
        IntOp $R5 340 * $R0
        IntOp $R5 $R5 / 96
        IntOp $R6 28 * $R0
        IntOp $R6 $R6 / 96
        System::Call 'user32::CreateWindowExW(i0,w "STATIC",w "$R8",i0x50000201,i$R3,i$R4,i$R5,i$R6,p$NeoQuizDialogueProgression,p0,p0,p0)p.R7'
        StrCpy $NeoQuizTexteAttente $R7
        SetCtlColors $NeoQuizTexteAttente C6D0F5 07101D
        System::Call 'gdi32::CreateFontW(i16,i0,i0,i0,i500,i0,i0,i0,i1,i0,i0,i0,i0,w "Segoe UI Variable Text")p.R7'
        StrCpy $NeoQuizPoliceTexte $R7
        SendMessage $NeoQuizTexteAttente ${WM_SETFONT} $NeoQuizPoliceTexte 1

        /* Barre de progression custom : plate, nette, sans relief Windows.
           Elle suit la vraie progression NSIS et reprend le bleu principal de
           l'installeur. */
        IntOp $NeoQuizBarreX 42 * $R0
        IntOp $NeoQuizBarreX $NeoQuizBarreX / 96
        IntOp $NeoQuizBarreY 116 * $R0
        IntOp $NeoQuizBarreY $NeoQuizBarreY / 96
        IntOp $NeoQuizBarreLargeur 336 * $R0
        IntOp $NeoQuizBarreLargeur $NeoQuizBarreLargeur / 96
        IntOp $NeoQuizBarreHauteur 7 * $R0
        IntOp $NeoQuizBarreHauteur $NeoQuizBarreHauteur / 96
        ${If} $NeoQuizBarreHauteur < 3
            StrCpy $NeoQuizBarreHauteur 3
        ${EndIf}

        System::Call 'user32::CreateWindowExW(i0,w "STATIC",w "",i0x50000000,i$NeoQuizBarreX,i$NeoQuizBarreY,i$NeoQuizBarreLargeur,i$NeoQuizBarreHauteur,p$NeoQuizDialogueProgression,p0,p0,p0)p.R7'
        StrCpy $NeoQuizPisteProgression $R7
        SetCtlColors $NeoQuizPisteProgression 000000 1D2A42

        System::Call 'user32::CreateWindowExW(i0,w "STATIC",w "",i0x50000000,i$NeoQuizBarreX,i$NeoQuizBarreY,i1,i$NeoQuizBarreHauteur,p$NeoQuizDialogueProgression,p0,p0,p0)p.R7'
        StrCpy $NeoQuizRemplissageProgression $R7
        SetCtlColors $NeoQuizRemplissageProgression 000000 5B9DFF

        ${NSD_CreateTimer} un.NeoQuizRafraichirDesinstallation 35
        Call un.NeoQuizRafraichirDesinstallation
    FunctionEnd

    Function un.NeoQuizRafraichirDesinstallation
        ${If} $NeoQuizProgressionNative == 0
            Return
        ${EndIf}

        SendMessage $NeoQuizProgressionNative ${PBM_GETRANGE} 0 0 $R0
        SendMessage $NeoQuizProgressionNative ${PBM_GETPOS} 0 0 $R1
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

        IntOp $R3 $NeoQuizBarreLargeur * $R2
        IntOp $R3 $R3 / 100
        ${If} $R3 <= 0
            ShowWindow $NeoQuizRemplissageProgression ${SW_HIDE}
        ${Else}
            System::Call 'user32::MoveWindow(p$NeoQuizRemplissageProgression,i$NeoQuizBarreX,i$NeoQuizBarreY,i$R3,i$NeoQuizBarreHauteur,i1)'
            ShowWindow $NeoQuizRemplissageProgression ${SW_SHOW}
        ${EndIf}
    FunctionEnd

    !macro customUnInstall
        SetDetailsPrint listonly
    !macroend

    Function un.NeoQuizIgnorerPageFinale
        ${NSD_KillTimer} un.NeoQuizRafraichirDesinstallation
        Abort
    FunctionEnd

    !macro customUninstallPage
        /* Aucun écran final : la petite fenêtre disparaît quand la vraie
           désinstallation est terminée. */
        !define MUI_PAGE_CUSTOMFUNCTION_PRE un.NeoQuizIgnorerPageFinale
    !macroend
!endif
