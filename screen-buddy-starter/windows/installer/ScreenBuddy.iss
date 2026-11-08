; Setup wizard for Screen Buddy. Built by .github/workflows/windows-release.yml after `dotnet publish`:
;   ISCC.exe /DAppVersion=1.2.3 installer\ScreenBuddy.iss      ->  publish\ScreenBuddy-Setup-1.2.3.exe
; Installs for the current user only (no admin prompt) into %LOCALAPPDATA%\Programs\Screen Buddy, which the app
; can write to, so self-update keeps working. The app adds its own desktop and Start menu shortcuts on first run.
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{6FB5FA52-ED6B-4AFB-AFF0-EB3DE92CF890}
AppName=Screen Buddy
AppVersion={#AppVersion}
AppVerName=Screen Buddy {#AppVersion}
AppPublisher=Illyrobotic AI
AppPublisherURL=https://screenbuddy.web.app/
DefaultDirName={localappdata}\Programs\Screen Buddy
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\publish
OutputBaseFilename=ScreenBuddy-Setup-{#AppVersion}
SetupIconFile=..\src\ScreenBuddy.App\app.ico
UninstallDisplayIcon={app}\ScreenBuddy.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
; if Screen Buddy is running, offer to close it before replacing its files
CloseApplications=yes
RestartApplications=no

[Files]
Source: "..\publish\ScreenBuddy\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userprograms}\Screen Buddy"; Filename: "{app}\ScreenBuddy.exe"

[Run]
Filename: "{app}\ScreenBuddy.exe"; Description: "Start Screen Buddy now"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/F /IM ScreenBuddy.exe"; Flags: runhidden; RunOnceId: "StopScreenBuddy"

[UninstallDelete]
; files added by self-updates are not in the installer's log, and the app made this shortcut itself
Type: filesandordirs; Name: "{app}"
Type: files; Name: "{userdesktop}\Screen Buddy.lnk"
