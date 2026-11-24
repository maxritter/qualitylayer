; This helper runs independently of the App: Defender can block every bundled executable.
; Capture the source directory here, before Tauri expands the macros in its generated script.
!define QL_WINDOWS_HOOK_DIR "${__FILEDIR__}"

!macro QL_RUN_DEFENDER_REPAIR ARGUMENT
  Push $R8
  Push $R9
  StrCpy $R8 "$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
  ; NSIS is a 32-bit process. Sysnative reaches native PowerShell on x64 and ARM64 Windows.
  IfFileExists "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" 0 +2
    StrCpy $R8 "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
  ExecWait '"$R8" -NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$INSTDIR\QualityLayer-Windows-Repair.ps1" ${ARGUMENT}' $R9
  ; Bypass is scoped to this process; no execution policy is changed on the device.
  DetailPrint "QualityLayer Windows security check returned $R9"
  Pop $R9
  Pop $R8
!macroend

!macro QL_RETIRE_BINARY FILENAME
  ; Windows locks a running .exe against overwrite, not rename. Moving an existing copy aside
  ; lets long-lived CLI processes (memory mcp, peers shim, running agent commands) keep running
  ; while NSIS writes the new executable cleanly.
  ${If} ${FileExists} "$INSTDIR\${FILENAME}.exe"
    Push $R8
    Push $R9
    StrCpy $R8 0
    ${DoWhile} $R8 < 64
      StrCpy $R9 "$INSTDIR\${FILENAME}.old-$R8.exe"
      ${IfNot} ${FileExists} "$R9"
        ClearErrors
        Rename "$INSTDIR\${FILENAME}.exe" "$R9"
        ${IfNot} ${Errors}
          Delete /REBOOTOK "$R9"
        ${EndIf}
        ${ExitDo}
      ${EndIf}
      IntOp $R8 $R8 + 1
    ${Loop}
    Pop $R9
    Pop $R8
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro QL_RETIRE_BINARY "qualitylayer-cli"
  !insertmacro QL_RETIRE_BINARY "qualitylayer-launcher"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Clean up retired copies whose old processes have already exited.
  Delete "$INSTDIR\qualitylayer-cli.old-*.exe"
  Delete "$INSTDIR\qualitylayer-launcher.old-*.exe"
  SetOutPath "$INSTDIR"
  File /oname=QualityLayer-Windows-Repair.ps1 "${QL_WINDOWS_HOOK_DIR}\repair-defender.ps1"
  ${If} $NoShortcutMode <> 1
  ${AndIf} $UpdateMode <> 1
    CreateShortCut "$SMPROGRAMS\QualityLayer - Repair Windows launch.lnk" "$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" '-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$INSTDIR\QualityLayer-Windows-Repair.ps1" -Launch'
  ${EndIf}
  ; Unattended installs and updates never change security settings or show an elevation prompt.
  ${If} $UpdateMode <> 1
  ${AndIf} $PassiveMode <> 1
    IfSilent ql_security_install_done
    !insertmacro QL_RUN_DEFENDER_REPAIR "-Automatic"
  ${EndIf}
  ql_security_install_done:
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; An update can invoke the old uninstaller; keep the approval and ownership record for it.
  ${If} $UpdateMode <> 1
    IfFileExists "$INSTDIR\.qualitylayer-asr.json" 0 ql_security_uninstall_done
    IfSilent ql_security_uninstall_done
    ${If} $PassiveMode <> 1
      !insertmacro QL_RUN_DEFENDER_REPAIR "-Remove"
    ${EndIf}
  ${EndIf}
  ql_security_uninstall_done:
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    Delete "$SMPROGRAMS\QualityLayer - Repair Windows launch.lnk"
    ; If cleanup was declined or blocked, retain the helper and record for a later -Remove.
    IfFileExists "$INSTDIR\.qualitylayer-asr.json" ql_security_keep_helper
    Delete "$INSTDIR\QualityLayer-Windows-Repair.ps1"
    Delete "$INSTDIR\.qualitylayer-asr.json.tmp"
    Delete /REBOOTOK "$INSTDIR\qualitylayer-cli.old-*.exe"
    Delete /REBOOTOK "$INSTDIR\qualitylayer-launcher.old-*.exe"
    RMDir "$INSTDIR"
  ${EndIf}
  ql_security_keep_helper:
!macroend
