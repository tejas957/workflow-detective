@echo off
rem Builds build\WorkflowDetective.exe on any Windows 10/11 PC with the C# compiler that ships with Windows
rem (.NET Framework 4.x). Nothing to download or install.
setlocal enabledelayedexpansion
cd /d "%~dp0"
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" set CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe
if not exist "%CSC%" ( echo Could not find the .NET Framework C# compiler. & exit /b 1 )

if exist build rmdir /s /q build
mkdir build\ui\lib build\ui\icons
set EXT=..\extension
for %%f in (onboarding.html onboarding.js report.html report.js ui.css) do copy /y "%EXT%\%%f" build\ui\ >nul
copy /y "%EXT%\lib\detector.js" build\ui\lib\ >nul
copy /y "%EXT%\lib\settings.js" build\ui\lib\ >nul
copy /y "%EXT%\lib\invite.js" build\ui\lib\ >nul
copy /y "%EXT%\icons\48.png" build\ui\icons\ >nul
copy /y ui\wd-desktop.js build\ui\ >nul
copy /y ui\lib\db.js build\ui\lib\db.js >nul

set RES=
for %%f in (onboarding.html onboarding.js report.html report.js ui.css wd-desktop.js) do set RES=!RES! /resource:build\ui\%%f,ui/%%f
for %%f in (detector.js settings.js invite.js db.js) do set RES=!RES! /resource:build\ui\lib\%%f,ui/lib/%%f
set RES=!RES! /resource:build\ui\icons\48.png,ui/icons/48.png

"%CSC%" /nologo /target:winexe /platform:anycpu /optimize+ /nowarn:618 /out:build\WorkflowDetective.exe /win32icon:app.ico ^
  /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:Accessibility.dll /r:Microsoft.CSharp.dll ^
  !RES! src\*.cs
if errorlevel 1 ( echo Build failed. & exit /b 1 )
echo Built build\WorkflowDetective.exe
