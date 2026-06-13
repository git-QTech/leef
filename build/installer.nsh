!pragma warning disable 6001
!pragma warning disable 6010

Var WelcomeTitle
Var WelcomeText

!define MUI_WELCOMEPAGE_TITLE $WelcomeTitle
!define MUI_WELCOMEPAGE_TEXT $WelcomeText

# Set custom headers, font face, and colors for Leef brand identity
!define MUI_BGCOLOR "EBFBEB"
!define MUI_TEXTCOLOR "121212"
!define MUI_FONT "Outfit"
!define MUI_FONTSIZE "10"

!macro customInit
  # Check if com.quinn.leefbrowser is already installed (Registry check for updates)
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.quinn.leefbrowser" "UninstallString"
  StrCmp $0 "" not_installed
    StrCpy $WelcomeTitle "Leef is installing as fast as it can!"
    StrCpy $WelcomeText "This should only take a moment..."
    Goto end
  not_installed:
    StrCpy $WelcomeTitle "Welcome to the Leef Family!"
    StrCpy $WelcomeText "This should only take a moment..."
  end:
!macroend
