; Custom NSIS, referenced from electron-builder.yml as `nsis.include`.
;
; One job: remove the copy of the installer that electron-builder leaves in
; %LOCALAPPDATA% on every install. Every line number below was read against
; **electron-builder 26.15.3**, which is pinned - so a bump is the moment to
; re-check them rather than to trust them. `include/installer.nsh:93` in
; app-builder-lib runs
;
;   !insertmacro copyFile "$EXEPATH" "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
;
; on the embedded-payload path this build takes, and nothing in `uninstaller.nsh`
; ever references it again. At ~200 MB that is a quarter of the app's footprint
; again, it outlives the uninstall, and it lands on the drive holding the Windows
; profile even when the user moved the install directory to another one - so the
; README's "put it somewhere else if C: is tight" would otherwise be half true.
;
; It exists to serve electron-updater's `--package-file` reinstall flow, which
; ADR-0014 rejected. Nothing in this product will ever read it.
;
; `customInstall` is inserted at `installSection.nsh:82`, after
; `installApplicationFiles` at line 66 - so the copy has already happened by the
; time this runs, which is why this deletes rather than prevents.
;
; That insertion is verified rather than assumed, because `!ifmacrodef` fails
; silently: an undefined macro placed in this body made makensis abort with
; `Error in macro customInstall on macroline 6 / !include: error in script:
; "installSection.nsh" on line 82`. A size comparison was tried first and was
; useless - 191 bytes against ~96 bytes of build nondeterminism.

!macro customInstall
  ; Guarded because the define only exists on the embedded-payload path. On a web
  ; installer electron-builder sets APP_PACKAGE_STORE_FILE instead and there is no
  ; copy of the installer to remove, so doing nothing is the correct answer rather
  ; than a silent miss. The copy at include/installer.nsh:93 *references* this
  ; define, so it cannot happen while the define is absent.
  !ifdef APP_INSTALLER_STORE_FILE
    Push $R8
    Push $R9

    ; The same bracket electron-builder puts around its own copy
    ; (include/installer.nsh:89-96, "electron always uses per user app data"), and
    ; it is not
    ; ceremony: $LOCALAPPDATA is context-sensitive in NSIS, and under
    ; `SetShellVarContext all` it resolves to the machine-wide AppData rather than
    ; to this user's. Without this, a per-all-users install copies to the user's
    ; directory and this looks in the machine's - Delete no-ops, RMDir no-ops, the
    ; 200 MB survives, and nothing anywhere reports it.
    ;
    ; `perMachine: false` does not put that out of reach: an assisted installer
    ; compiles `setInstallModePerAllUsers` in regardless, and `/allusers` on the
    ; command line, an HKLM InstallLocation, or a silent upgrade of a per-machine
    ; installation each reach it.
    ${if} $installMode == "all"
      SetShellVarContext current
    ${endif}

    ; Derived from the define, never written out. The directory name comes from
    ; the *workspace package* name - `@hecaton/shell` becomes
    ; `@hecatonshell-updater`, via AppInfo.updaterCacheDirName - and not from the
    ; product name. Probe P1 predicted `hecaton-updater` and was wrong, which is
    ; the argument against hardcoding it.
    StrCpy $R9 "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"

    ; Failure here is an expected outcome rather than a problem, and is
    ; deliberately silent. The reachable case: the running installer *is* that
    ; copy, which is precisely what electron-updater's reinstall flow does, so the
    ; image is locked. No /REBOOTOK - scheduling a reboot over a cache file would
    ; be worse than leaving it.
    Delete "$R9"

    ; A bare RMDir, and this line is what stands between a malformed define and a
    ; catastrophe rather than a style preference. Were ${APP_INSTALLER_STORE_FILE}
    ; ever empty, $R8 would be $LOCALAPPDATA itself - and `RMDir` removes nothing
    ; unless the directory is already empty, so that case is a no-op, where
    ; `RMDir /r` on the same input would erase the user's whole local AppData.
    ${GetParent} "$R9" $R8
    RMDir "$R8"

    ${if} $installMode == "all"
      SetShellVarContext all
    ${endif}

    ; Leave no trace: both calls above set the error flag on failure, and this
    ; macro borrows the install section rather than owning it. Nothing downstream
    ; reads the flag today - which is why this is one line now rather than a bug
    ; later.
    ClearErrors

    Pop $R9
    Pop $R8
  !endif
!macroend
