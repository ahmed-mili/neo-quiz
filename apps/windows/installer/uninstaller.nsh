!include "LogicLib.nsh"
!include "WinMessages.nsh"
!include "nsDialogs.nsh"

!ifdef BUILD_UNINSTALLER
	/* Le moteur NSIS reste en mode assisté pour l'installation, mais la
	   désinstallation ne doit pas imposer un assistant à l'utilisateur. */
	!define removeDefaultUninstallWelcomePage
	!define MUI_CUSTOMFUNCTION_UNGUIINIT un.NeoQuizInitialiserDesinstallation
	AutoCloseWindow true

	Var NeoQuizDesinstallationCompacte
	Var NeoQuizDialogueProgression
	Var NeoQuizBarreProgression
	Var NeoQuizTexteProgression

	Function un.NeoQuizInitialiserDesinstallation
		StrCpy $NeoQuizDesinstallationCompacte "0"
		/* electron-builder ne fournit aucun crochet entre sa page de choix du
		   mode d'installation et la page de progression. Attendre la présence
		   de la barre évite de détourner la page de choix dans le cas rare où
		   deux installations, utilisateur et machine, coexistent. */
		${NSD_CreateTimer} un.NeoQuizRafraichirDesinstallation 40
	FunctionEnd

	Function un.NeoQuizCompacterDesinstallation
		SendMessage $HWNDPARENT ${WM_SETTEXT} 0 "STR:${PRODUCT_NAME}"

		/* Les boutons sont inutiles une fois la suppression engagée et garderaient
		   sinon la hauteur du wizard que l'on cherche précisément à éviter. */
		GetDlgItem $0 $HWNDPARENT 1
		ShowWindow $0 ${SW_HIDE}
		GetDlgItem $0 $HWNDPARENT 2
		ShowWindow $0 ${SW_HIDE}
		GetDlgItem $0 $HWNDPARENT 3
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
		GetDlgItem $0 $HWNDPARENT 1028
		ShowWindow $0 ${SW_HIDE}

		GetDlgItem $0 $NeoQuizDialogueProgression 1027
		ShowWindow $0 ${SW_HIDE}
		GetDlgItem $0 $NeoQuizDialogueProgression 1016
		ShowWindow $0 ${SW_HIDE}

		/* Les dimensions logiques sont volontairement proches d'une petite boîte
		   de progression Windows ; les convertir avec le DPI évite une fenêtre
		   minuscule ou énorme lorsque l'échelle d'affichage n'est pas 100 %. */
		System::Call 'user32::GetDpiForWindow(p$HWNDPARENT)i.R0'
		${If} $R0 <= 0
			StrCpy $R0 96
		${EndIf}

		IntOp $R1 320 * $R0
		IntOp $R1 $R1 / 96
		IntOp $R2 100 * $R0
		IntOp $R2 $R2 / 96
		System::Call 'user32::GetSystemMetrics(i0)i.R3'
		System::Call 'user32::GetSystemMetrics(i1)i.R4'
		IntOp $R3 $R3 - $R1
		IntOp $R3 $R3 / 2
		IntOp $R4 $R4 - $R2
		IntOp $R4 $R4 / 2
		System::Call 'user32::MoveWindow(p$HWNDPARENT,i$R3,i$R4,i$R1,i$R2,i1)'

		IntOp $R3 14 * $R0
		IntOp $R3 $R3 / 96
		IntOp $R4 16 * $R0
		IntOp $R4 $R4 / 96
		IntOp $R5 292 * $R0
		IntOp $R5 $R5 / 96
		IntOp $R6 24 * $R0
		IntOp $R6 $R6 / 96
		System::Call 'user32::MoveWindow(p$NeoQuizDialogueProgression,i$R3,i$R4,i$R5,i$R6,i1)'
		System::Call 'user32::MoveWindow(p$NeoQuizBarreProgression,i0,i0,i$R5,i$R6,i1)'
		System::Call 'user32::MoveWindow(p$NeoQuizTexteProgression,i0,i0,i$R5,i$R6,i1)'

		/* Le texte de statut existant est réutilisé au-dessus de la barre plutôt
		   qu'un contrôle parallèle : il suit ainsi exactement la mise à l'échelle
		   et le cycle de vie de la page native NSIS. */
		System::Call 'user32::GetWindowLong(p$NeoQuizTexteProgression,i${GWL_STYLE})i.R7'
		IntOp $R7 $R7 & 0xFFFFFFE0
		IntOp $R7 $R7 | ${SS_CENTER}
		IntOp $R7 $R7 | ${SS_CENTERIMAGE}
		System::Call 'user32::SetWindowLong(p$NeoQuizTexteProgression,i${GWL_STYLE},i$R7)'
		SetCtlColors $NeoQuizTexteProgression 202124 transparent
		ShowWindow $NeoQuizTexteProgression ${SW_SHOW}

		StrCpy $NeoQuizDesinstallationCompacte "1"
	FunctionEnd

	Function un.NeoQuizRafraichirDesinstallation
		FindWindow $NeoQuizDialogueProgression "#32770" "" $HWNDPARENT
		${If} $NeoQuizDialogueProgression == 0
			Return
		${EndIf}

		GetDlgItem $NeoQuizBarreProgression $NeoQuizDialogueProgression 1004
		${If} $NeoQuizBarreProgression == 0
			Return
		${EndIf}
		GetDlgItem $NeoQuizTexteProgression $NeoQuizDialogueProgression 1006
		${If} $NeoQuizTexteProgression == 0
			Return
		${EndIf}

		${If} $NeoQuizDesinstallationCompacte != "1"
			Call un.NeoQuizCompacterDesinstallation
		${EndIf}

		/* NSIS peut réafficher les boutons au changement de page ; les maintenir
		   cachés ici évite un flash de navigation pendant les dernières étapes. */
		GetDlgItem $0 $HWNDPARENT 1
		ShowWindow $0 ${SW_HIDE}
		GetDlgItem $0 $HWNDPARENT 2
		ShowWindow $0 ${SW_HIDE}
		GetDlgItem $0 $HWNDPARENT 3
		ShowWindow $0 ${SW_HIDE}

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
		/* La ligne de statut native écraserait sinon le pourcentage à chaque
		   suppression de fichier, alors que la liste détaillée reste masquée. */
		SetDetailsPrint listonly
	!macroend

	Function un.NeoQuizIgnorerPageFinale
		${NSD_KillTimer} un.NeoQuizRafraichirDesinstallation
		Abort
	FunctionEnd

	!macro customUninstallPage
		/* Une page « Terminé » demanderait encore un clic alors que la demande
		   de désinstallation a déjà été explicite dans Windows. */
		!define MUI_PAGE_CUSTOMFUNCTION_PRE un.NeoQuizIgnorerPageFinale
	!macroend
!endif
