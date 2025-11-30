@echo off
setlocal
set "WSL_PATH='<PROJECTS_DIR>/cDNA-calculations-app/modern-app'"
start "cDNA app servers" wsl -e bash -lc "cd %WSL_PATH% && npm run dev:full"
timeout /t 4 >nul
start "" http://localhost:5176
endlocal
