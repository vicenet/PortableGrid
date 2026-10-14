; PortableGrid Windows installer (Inno Setup 6).
; Build:  iscc /DAppVersion=0.3.0 /DSourceDir=<staged extension folder> installer\windows\PortableGrid.iss
; Installs for the current user into Adobe's CEP extensions folder (no admin rights needed).

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #error "Pass /DSourceDir=<path to the staged extension folder>"
#endif

[Setup]
AppId={{2FCA83D0-8CF3-4F15-8821-EA065EF0E620}
AppName=PortableGrid
AppVersion={#AppVersion}
AppVerName=PortableGrid {#AppVersion}
AppPublisher=PortableGrid
AppPublisherURL=https://github.com/vicenet/PortableGrid
AppSupportURL=https://github.com/vicenet/PortableGrid/issues
AppUpdatesURL=https://github.com/vicenet/PortableGrid/releases
DefaultDirName={userappdata}\Adobe\CEP\extensions\PortableGrid
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=no
PrivilegesRequired=lowest
LicenseFile=..\..\LICENSE
SetupIconFile=PortableGrid.ico
UninstallDisplayIcon={app}\installer-icon.ico
UninstallDisplayName=PortableGrid (Adobe Illustrator & Photoshop extension)
OutputDir=..\..\dist
OutputBaseFilename=PortableGrid-{#AppVersion}-setup
Compression=lzma2/ultra
SolidCompression=yes
WizardStyle=modern
VersionInfoVersion={#AppVersion}
VersionInfoDescription=PortableGrid installer

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "PortableGrid.ico"; DestDir: "{app}"; DestName: "installer-icon.ico"; Flags: ignoreversion

[InstallDelete]
; Remove files from older versions before copying the new ones.
Type: filesandordirs; Name: "{app}\*"

[Registry]
; Lets Adobe load the extension (also Adobe's workaround for blank signed panels). CEP 9-12.
Root: HKCU; Subkey: "Software\Adobe\CSXS.9"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"
Root: HKCU; Subkey: "Software\Adobe\CSXS.10"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"
Root: HKCU; Subkey: "Software\Adobe\CSXS.11"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"
Root: HKCU; Subkey: "Software\Adobe\CSXS.12"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"

[Messages]
FinishedLabel=PortableGrid is installed.%n%nRestart Illustrator or Photoshop, then open Window > Extensions > PortableGrid (in Photoshop: Window > Extensions (Legacy) > PortableGrid).

[Code]
// FILE_ATTRIBUTE_REPARSE_POINT is predefined by Inno Setup.
// A developer setup links this folder to a source checkout. Installing over it would overwrite the
// source files, so stop instead.
function IsLinkedFolder(const Path: String): Boolean;
var
  Rec: TFindRec;
begin
  Result := False;
  if FindFirst(Path, Rec) then
  begin
    Result := (Rec.Attributes and FILE_ATTRIBUTE_REPARSE_POINT) <> 0;
    FindClose(Rec);
  end;
end;

function InitializeSetup(): Boolean;
var
  Target: String;
begin
  Result := True;
  Target := ExpandConstant('{userappdata}\Adobe\CEP\extensions\PortableGrid');
  if IsLinkedFolder(Target) then
  begin
    MsgBox('A development copy of PortableGrid is linked at:' + #13#10 + Target + #13#10#13#10 +
      'Remove that link first, then run this installer again.', mbError, MB_OK);
    Result := False;
  end;
end;
