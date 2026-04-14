@echo off
REM Aureate Crystals — local static file server
REM Serves the current folder at http://localhost:8000
REM Press Ctrl+C to stop.

cd /d "%~dp0"

echo.
echo  Serving Aureate Crystals at http://localhost:8000
echo  Press Ctrl+C to stop.
echo.

REM Open the site in the default browser (non-blocking)
start "" "http://localhost:8000"

REM Try the Windows Python launcher first, then fall back to python/python3
where py >nul 2>nul
if %ERRORLEVEL% == 0 (
    py -m http.server 8000
    goto :eof
)

where python >nul 2>nul
if %ERRORLEVEL% == 0 (
    python -m http.server 8000
    goto :eof
)

where python3 >nul 2>nul
if %ERRORLEVEL% == 0 (
    python3 -m http.server 8000
    goto :eof
)

where npx >nul 2>nul
if %ERRORLEVEL% == 0 (
    npx --yes serve -l 8000 .
    goto :eof
)

echo.
echo  ERROR: No Python or Node.js found. Install one of:
echo    - Python (https://python.org)
echo    - Node.js (https://nodejs.org)
echo.
pause
