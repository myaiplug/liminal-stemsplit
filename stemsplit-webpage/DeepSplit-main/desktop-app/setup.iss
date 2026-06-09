; usage: iscc setup.iss

#define MyAppName "StemSplit"
#define MyAppVersion "0.4.0"
#define MyAppPublisher "StemSplit Team"
#define MyAppExeName "StemSplit.exe"
#define MyAppDisplayName "StemSplit"

[Setup]
; NOTE: The value of AppId uniquely identifies this application. Do not use the same AppId value in installers for other applications.
; (To generate a new GUID, click Tools | Generate GUID inside the IDE.)
AppId={{C6260D04-8E6F-46C3-9366-231362002302}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
; The following line to use the icon
SetupIconFile=ss2.ico
Compression=lzma2/normal
SolidCompression=yes
DiskSpanning=yes
DiskSliceSize=max
OutputDir=installers
OutputBaseFilename=StemSplit_Setup_v0.4.0_x64
; "ArchitecturesAllowed=x64" specifies that Setup cannot run on anything but x64.
ArchitecturesAllowed=x64
; "ArchitecturesInstallIn64BitMode=x64" requests that the install be done in "64-bit mode" on x64, meaning it should use the native 64-bit Program Files directory and the 64-bit view of the registry.
ArchitecturesInstallIn64BitMode=x64
; Uninstall info for detecting existing installation
UninstallDisplayIcon={app}\ss2.ico
UninstallDisplayName={#MyAppName}
; Show what version is being installed
AppVerName={#MyAppName} v{#MyAppVersion}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; =============================================================================
; CORE FILES (REQUIRED)
; =============================================================================

; Main Executable
Source: "src-tauri\target\release\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion

; Python Environment (Embedded) - CRITICAL!
Source: "embedded_python\*"; DestDir: "{app}\embedded_python"; Flags: recursesubdirs createallsubdirs ignoreversion; Excludes: "__pycache__,*.pyc,*.pyo"

; Application Scripts - Core splitting logic
Source: "scripts\splitter.py"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "scripts\apply_fx.py"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "scripts\hardware.py"; DestDir: "{app}\scripts"; Flags: ignoreversion

; FFmpeg for MP3 encoding - CRITICAL!
Source: "ffmpeg\bin\ffmpeg.exe"; DestDir: "{app}\ffmpeg"; Flags: ignoreversion
Source: "ffmpeg\bin\ffprobe.exe"; DestDir: "{app}\ffmpeg"; Flags: ignoreversion

; Icons & Assets
Source: "ss2.ico"; DestDir: "{app}"; Flags: ignoreversion

; =============================================================================
; OPTIONAL COMPONENTS (skip if not present during build)
; These are additional AI engines that enhance separation quality
; =============================================================================

; DrumSep Engine (optional - for drum-specific separation)
Source: "drumsep-main\*"; DestDir: "{app}\drumsep-main"; Flags: recursesubdirs createallsubdirs skipifsourcedoesntexist; Excludes: "__pycache__,.git,.github,.gitattributes,.gitignore,*.md,LICENSE"

; MDX23 Engine (optional - high quality separation)
Source: "MVSEP-MDX23-music-separation-model-main\*"; DestDir: "{app}\MVSEP-MDX23-music-separation-model-main"; Flags: recursesubdirs createallsubdirs skipifsourcedoesntexist; Excludes: "__pycache__,.git,output,*.wav,gui.py,web-ui.py,*.md,images"

; UVR Engine (optional - Ultimate Vocal Remover models)
Source: "UVR\*"; DestDir: "{app}\UVR"; Flags: recursesubdirs createallsubdirs skipifsourcedoesntexist; Excludes: "__pycache__,.git,*.png,*.jpg"

; Pre-trained AI Models (optional - downloaded on first use if missing)
Source: "Stem Split Models\*"; DestDir: "{app}\Stem Split Models"; Flags: recursesubdirs createallsubdirs skipifsourcedoesntexist

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\ss2.ico"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon; IconFilename: "{app}\ss2.ico"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent

[Code]
// Check if the application is already installed
function GetInstalledVersion(): String;
var
  InstalledVersion: String;
begin
  Result := '';
  // Check registry for installed version (64-bit registry)
  if RegQueryStringValue(HKLM64, 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{#SetupSetting("AppId")}_is1',
    'DisplayVersion', InstalledVersion) then
  begin
    Result := InstalledVersion;
  end
  // Also check 32-bit registry location as fallback
  else if RegQueryStringValue(HKLM32, 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{#SetupSetting("AppId")}_is1',
    'DisplayVersion', InstalledVersion) then
  begin
    Result := InstalledVersion;
  end;
end;

function GetInstalledPath(): String;
var
  InstalledPath: String;
begin
  Result := '';
  if RegQueryStringValue(HKLM64, 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{#SetupSetting("AppId")}_is1',
    'InstallLocation', InstalledPath) then
  begin
    Result := InstalledPath;
  end
  else if RegQueryStringValue(HKLM32, 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{#SetupSetting("AppId")}_is1',
    'InstallLocation', InstalledPath) then
  begin
    Result := InstalledPath;
  end;
end;

function InitializeSetup(): Boolean;
var
  InstalledVersion: String;
  InstalledPath: String;
  MsgResult: Integer;
begin
  Result := True;
  
  InstalledVersion := GetInstalledVersion();
  InstalledPath := GetInstalledPath();
  
  if InstalledVersion <> '' then
  begin
    // Compare versions
    if InstalledVersion = '{#MyAppVersion}' then
    begin
      // Same version already installed
      MsgResult := MsgBox(
        '{#MyAppName} v' + InstalledVersion + ' is already installed.' + #13#10 + #13#10 +
        'Location: ' + InstalledPath + #13#10 + #13#10 +
        'Do you want to reinstall/repair the application?' + #13#10 + #13#10 +
        'Click Yes to reinstall, or No to cancel.',
        mbConfirmation, MB_YESNO);
      
      if MsgResult = IDNO then
      begin
        Result := False; // Cancel installation
      end;
    end
    else
    begin
      // Different version installed - offer upgrade
      MsgResult := MsgBox(
        '{#MyAppName} v' + InstalledVersion + ' is currently installed.' + #13#10 + #13#10 +
        'This installer will upgrade to v{#MyAppVersion}.' + #13#10 + #13#10 +
        'Do you want to continue with the upgrade?',
        mbConfirmation, MB_YESNO);
      
      if MsgResult = IDNO then
      begin
        Result := False; // Cancel installation
      end;
    end;
  end;
end;

// Close the running application before uninstall/upgrade
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  ExePath: String;
begin
  Result := '';
  ExePath := ExpandConstant('{app}\{#MyAppExeName}');
  
  // Try to close running instance gracefully
  if FileExists(ExePath) then
  begin
    // Use taskkill to close the application if running
    Exec('taskkill', '/F /IM {#MyAppExeName}', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    // Small delay to ensure process is fully terminated
    Sleep(500);
  end;
end;
