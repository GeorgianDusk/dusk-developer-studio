@echo off
setlocal
echo Dusk Developer Studio will be allowed to check local tools and create starter files.
echo No wallet signing or funded-account action is enabled.
"%~dp0..\runtime\node.exe" "%~dp0..\app\companion.mjs" --enable-local-actions
set "DUSK_STUDIO_EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %DUSK_STUDIO_EXIT_CODE%
