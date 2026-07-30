; Uninstaller additions for D4b: an opt-in "delete all my data" choice.
;
; Read probe P1's findings in docs/plans/phase-3-distribution.md before touching
; this. Three measured facts shape every line below:
;
;   1. An update runs the PREVIOUS version's uninstaller, always with /S, passing
;      --updated. So an unguarded branch here runs on every update, and `${isUpdated}`
;      is the only thing separating "the user asked to delete their data" from
;      "the user installed a newer version".
;   2. Because it is the previous release's binary, whatever is written here is
;      frozen for everyone who has already installed. A mistake cannot be fixed by
;      shipping 0.1.2. That is why the deletion itself is NOT here.
;   3. During an update the uninstaller is silent, so no page is shown and a
;      checkbox keeps whatever value it was initialised with. The absence of the
;      page is not the absence of the branch.
;
; So this file decides *whether* the user asked, and the app decides *what* gets
; removed - in `planUserDataDeletion`, which the fast suite covers. The one thing
; deleted here is the cached copy of the installer, whose exact path only NSIS
; knows (electron-builder derives the directory name from the package name), and
; which holds no session data: it is a copy of a public installer.

; Everything below is uninstaller-only. electron-builder compiles this file twice -
; once for the installer, once for the uninstaller - and the uninstaller pages are
; themselves inside a BUILD_UNINSTALLER branch of the template. Leaving `un.`
; functions visible to the installer pass leaves them orphaned there, which NSIS
; reports as warning 6020 and electron-builder treats warnings as errors.
!ifdef BUILD_UNINSTALLER

!include nsDialogs.nsh

Var UnDeleteDataCheckbox
Var UnDeleteData

; The checkbox rides the uninstaller's welcome page, which is the last moment the
; user can still be asked. Unchecked by default, deliberately: D4b says keeping the
; data is the default, and a silent uninstall - which is what an update performs -
; shows no page at all, so $UnDeleteData stays empty and means "keep".
!macro customUnWelcomePage
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.ShowDeleteDataChoice
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE un.ReadDeleteDataChoice
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

Function un.ShowDeleteDataChoice
  ; The label names all three things the scope covers, because the scope grew past
  ; "profiles" and the text has to match what the code does.
  ${NSD_CreateCheckbox} 120u -20u 90% 22u "Apagar todos os meus dados (perfis, configuração e logs)"
  Pop $UnDeleteDataCheckbox
  SetCtlColors $UnDeleteDataCheckbox "" "${MUI_BGCOLOR}"
FunctionEnd

Function un.ReadDeleteDataChoice
  ${NSD_GetState} $UnDeleteDataCheckbox $UnDeleteData
FunctionEnd

!macro customUnInstall
  ; Guarded even though the checkbox cannot be ticked on the update path: P1
  ; measured that an unguarded branch here runs on every update, and defence in
  ; depth costs one line.
  ${ifNot} ${isUpdated}
    ${If} $UnDeleteData == 1
      DetailPrint "Apagando os dados do usuário..."
      ; The app removes %APPDATA%/hecaton itself. It runs before the install
      ; directory is deleted, which is why this hook is usable at all:
      ; customUnInstall is inserted ahead of the RMDir that removes $INSTDIR.
      ; No path is passed - the app resolves it from its own constant, so no
      ; argument can redirect the deletion.
      ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --delete-user-data' $0
      ${If} $0 != 0
        DetailPrint "Não foi possível apagar os dados (código $0). Eles continuam em %APPDATA%\hecaton."
      ${EndIf}
    ${EndIf}

    ; The cached installer copy, which every install leaves behind and which no
    ; uninstall removes - 96 MB, orphaned, and only useful to the electron-updater
    ; flow D7 declined. Deleted by name and then the directory non-recursively:
    ; there is no `RMDir /r` in this file, so a wrong path can at worst fail.
    Delete "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
    !searchreplace UPDATER_CACHE_DIR "${APP_INSTALLER_STORE_FILE}" "\installer.exe" ""
    RMDir "$LOCALAPPDATA\${UPDATER_CACHE_DIR}"
  ${endIf}
!macroend

!endif ; BUILD_UNINSTALLER
