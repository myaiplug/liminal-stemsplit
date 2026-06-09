; Online Installer - Downloads Python during installation
; Usage: iscc setup_online.iss
; This creates a SMALL installer (~100MB) that downloads Python packages during install

#define MyAppName "NoDAW Liminal"
#define MyAppVersion "0.4.6"
#define MyAppPublisher "NoDAW"
#define MyAppBuildExeName "stem-split.exe"
#define MyAppExeName "Liminal™.exe"
#define PythonVersion "3.10.11"
#define PythonURL "https://www.python.org/ftp/python/3.10.11/python-3.10.11-embed-amd64.zip"
#define GetPipURL "https://bootstrap.pypa.io/get-pip.py"

[Setup]
AppId={{C6260D04-8E6F-46C3-9366-231362002302}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
SetupIconFile=ss2.ico
Compression=lzma2/ultra64
SolidCompression=yes
OutputDir=installers
OutputBaseFilename=Liminal-StemSplit-Setup-v0.4.6-Windows-x64-Online
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
UninstallDisplayIcon={app}\ss2.ico
UninstallDisplayName={#MyAppName}
AppVerName={#MyAppName} v{#MyAppVersion}
PrivilegesRequired=admin

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Main Executable
Source: "src-tauri\target\release\{#MyAppBuildExeName}"; DestDir: "{app}"; DestName: "{#MyAppExeName}"; Flags: ignoreversion

; Application Scripts
Source: "scripts\*"; DestDir: "{app}\scripts"; Flags: recursesubdirs createallsubdirs; Excludes: "logs, __pycache__, .git, .vscode, .idea, *.log, s3_*_folder_lists, test_audio, *.txt, *.bmp, *.png, *.json, *.xml, *.yaml"

; Model Dependencies
Source: "drumsep-main\*"; DestDir: "{app}\drumsep-main"; Flags: recursesubdirs createallsubdirs skipifsourcedoesntexist; Excludes: "__pycache__, .git, *.md, LICENSE, drumsepInstall, *.th, *.ckpt, *.pt, *.bin, *.onnx"
Source: "MVSEP-MDX23-music-separation-model-main\*"; DestDir: "{app}\MVSEP-MDX23-music-separation-model-main"; Flags: recursesubdirs createallsubdirs skipifsourcedoesntexist; Excludes: "__pycache__, .git, output, *.wav, gui.py, web-ui.py, *.md, images, *.th, *.ckpt, *.pt, *.bin, *.onnx"
Source: "UVR\*"; DestDir: "{app}\UVR"; Flags: recursesubdirs createallsubdirs skipifsourcedoesntexist; Excludes: "__pycache__, .git, *.png, *.jpg, *.th, *.ckpt, *.pt, *.bin, *.onnx"

; Trained Models
Source: "Stem Split Models\*"; DestDir: "{app}\Stem Split Models"; Flags: recursesubdirs createallsubdirs skipifsourcedoesntexist; Excludes: "*.th, *.ckpt, *.pt, *.bin, *.onnx"

; Requirements file for pip
Source: "requirements.txt"; DestDir: "{app}"; Flags: ignoreversion

; FFmpeg for MP3 encoding
Source: "ffmpeg\\ffmpeg.exe"; DestDir: "{app}\\ffmpeg"; Flags: ignoreversion skipifsourcedoesntexist

; Icons
Source: "ss2.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\ss2.ico"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon; IconFilename: "{app}\ss2.ico"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent

[Code]
var
  DownloadPage: TDownloadWizardPage;
  PythonInstallPage: TOutputProgressWizardPage;

function OnDownloadProgress(const Url, FileName: String; const Progress, ProgressMax: Int64): Boolean;
begin
  if Progress = ProgressMax then
    Log(Format('Successfully downloaded file to %s', [FileName]));
  Result := True;
end;

procedure InitializeWizard;
begin
  DownloadPage := CreateDownloadPage(SetupMessage(msgWizardPreparing), SetupMessage(msgPreparingDesc), @OnDownloadProgress);
  PythonInstallPage := CreateOutputProgressPage('Installing Python Packages', 'Please wait while Python packages are downloaded and installed...');
end;

function ExtractZipFile(ZipFile, DestDir: String): Boolean;
var
  Shell: Variant;
  ZipObj: Variant;
  DestObj: Variant;
begin
  Result := False;
  try
    Shell := CreateOleObject('Shell.Application');
    ZipObj := Shell.NameSpace(ZipFile);
    DestObj := Shell.NameSpace(DestDir);
    DestObj.CopyHere(ZipObj.Items, 4 or 16); // 4=No progress, 16=Yes to all
    Result := True;
  except
    Log('Failed to extract zip: ' + GetExceptionMessage);
  end;
end;

function EnableImportSite(PythonDir: String): Boolean;
var
  PthFile: String;
  ContentAnsi: AnsiString;
  Content: String;
begin
  Result := False;
  PthFile := PythonDir + '\python310._pth';
  if FileExists(PthFile) then
  begin
    if LoadStringFromFile(PthFile, ContentAnsi) then
    begin
      Content := ContentAnsi;
      StringChangeEx(Content, '#import site', 'import site', True);
      ContentAnsi := Content;
      Result := SaveStringToFile(PthFile, ContentAnsi, False);
    end;
  end;
end;

function RunPythonCommand(PythonDir, Args: String; var Output: String): Integer;
var
  ResultCode: Integer;
  ExecResult: Boolean;
begin
  ExecResult := Exec(PythonDir + '\python.exe', Args, PythonDir, SW_HIDE, ewWaitUntilTerminated, ResultCode);
  if ExecResult then
    Result := ResultCode
  else
    Result := -1;
end;

function GetInstalledVersion(): String;
var
  InstalledVersion: String;
begin
  Result := '';
  if RegQueryStringValue(HKLM64, 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{#SetupSetting("AppId")}_is1',
    'DisplayVersion', InstalledVersion) then
    Result := InstalledVersion
  else if RegQueryStringValue(HKLM32, 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{#SetupSetting("AppId")}_is1',
    'DisplayVersion', InstalledVersion) then
    Result := InstalledVersion;
end;

function GetInstalledPath(): String;
var
  InstalledPath: String;
begin
  Result := '';
  if RegQueryStringValue(HKLM64, 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{#SetupSetting("AppId")}_is1',
    'InstallLocation', InstalledPath) then
    Result := InstalledPath
  else if RegQueryStringValue(HKLM32, 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{#SetupSetting("AppId")}_is1',
    'InstallLocation', InstalledPath) then
    Result := InstalledPath;
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
    if InstalledVersion = '{#MyAppVersion}' then
    begin
      MsgResult := MsgBox(
        '{#MyAppName} v' + InstalledVersion + ' is already installed.' + #13#10 + #13#10 +
        'Location: ' + InstalledPath + #13#10 + #13#10 +
        'Reinstall/repair this version?',
        mbConfirmation, MB_YESNO);
      if MsgResult = IDNO then
        Result := False;
    end
    else
    begin
      MsgResult := MsgBox(
        '{#MyAppName} v' + InstalledVersion + ' is currently installed.' + #13#10 + #13#10 +
        'Upgrade to v{#MyAppVersion}?',
        mbConfirmation, MB_YESNO);
      if MsgResult = IDNO then
        Result := False;
    end;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  Exec('taskkill', '/F /IM {#MyAppExeName}', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Sleep(500);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  
  if CurPageID = wpReady then begin
#ifdef SkipOnlineDownloads
    Log('SkipOnlineDownloads enabled; skipping online dependency download/install phase.');
    Exit;
#endif
    Log('NoDAW Liminal defers AI runtime provisioning to first launch so installation always completes.');
  end;
end;

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo, MemoTypeInfo, MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
begin
  Result := '';
  Result := Result + 'Installation Directory:' + NewLine + Space + ExpandConstant('{app}') + NewLine + NewLine;
  Result := Result + 'Installer behavior:' + NewLine;
  Result := Result + Space + '• Installs NoDAW Liminal immediately without blocking on PyTorch' + NewLine;
  Result := Result + Space + '• First launch auto-downloads or repairs the AI runtime if needed' + NewLine;
  Result := Result + Space + '• If GPU packages fail, NoDAW Liminal falls back to a CPU-safe runtime automatically' + NewLine + NewLine;
  Result := Result + 'Recovery and diagnostics:' + NewLine;
  Result := Result + Space + '• Restarting NoDAW Liminal triggers runtime self-repair if setup was interrupted' + NewLine;
  Result := Result + Space + '• Diagnostics are written to %LOCALAPPDATA%\StemSplit\python-setup-diagnostics.json' + NewLine + NewLine;
  Result := Result + 'Internet is only required when the app provisions or repairs the AI runtime.' + NewLine;
end;
