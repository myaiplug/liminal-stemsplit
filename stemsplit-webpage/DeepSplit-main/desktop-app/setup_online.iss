; Online Installer - Downloads Python during installation
; Usage: iscc setup_online.iss
; This creates a SMALL installer (~100MB) that downloads Python packages during install

#define MyAppName "StemSplit"
#define MyAppVersion "0.4.0"
#define MyAppPublisher "StemSplit Team"
#define MyAppExeName "stem-split.exe"
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
OutputBaseFilename=StemSplit_Setup_v{#MyAppVersion}_x64_Online
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
; Need admin to install Python packages
PrivilegesRequired=admin

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Main Executable
Source: "src-tauri\target\release\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion

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

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  
  if CurPageID = wpReady then begin
#ifdef SkipOnlineDownloads
    Log('SkipOnlineDownloads enabled; skipping online dependency download/install phase.');
    Exit;
#endif
    Log('StemSplit online installer now defers Python/PyTorch provisioning to first launch so installation can finish even when runtime downloads fail.');
  end;
end;

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo, MemoTypeInfo, MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
begin
  Result := '';
  Result := Result + 'Installation Directory:' + NewLine + Space + ExpandConstant('{app}') + NewLine + NewLine;
  Result := Result + 'Installer behavior:' + NewLine;
  Result := Result + Space + '• Installs StemSplit immediately without blocking on PyTorch' + NewLine;
  Result := Result + Space + '• First launch auto-downloads or repairs the AI runtime if needed' + NewLine;
  Result := Result + Space + '• If GPU packages fail, StemSplit falls back to a CPU-safe runtime automatically' + NewLine + NewLine;
  Result := Result + 'Recovery and diagnostics:' + NewLine;
  Result := Result + Space + '• Restarting StemSplit triggers runtime self-repair if setup was interrupted' + NewLine;
  Result := Result + Space + '• Diagnostics are written to %LOCALAPPDATA%\StemSplit\python-setup-diagnostics.json' + NewLine + NewLine;
  Result := Result + 'Internet is only required when the app provisions or repairs the AI runtime.' + NewLine;
end;
