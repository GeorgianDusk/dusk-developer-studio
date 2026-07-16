@echo off
setlocal
"%~dp0..\runtime\node.exe" "%~dp0..\app\companion.mjs"
set "DUSK_STUDIO_EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %DUSK_STUDIO_EXIT_CODE%
