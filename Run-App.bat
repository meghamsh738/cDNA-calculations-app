@echo off
setlocal EnableDelayedExpansion
set "WIN_DIR=%~dp0"
set "WSL_DRIVE=%WIN_DIR:~0,1%"
set "WSL_PATH=%WIN_DIR:~2%"
set "WSL_PATH=%WSL_PATH:\=/%"
for %%L in (A=a B=b C=c D=d E=e F=f G=g H=h I=i J=j K=k L=l M=m N=n O=o P=p Q=q R=r S=s T=t U=u V=v W=w X=x Y=y Z=z) do (
    for /f "tokens=1,2 delims==" %%a in ("%%L") do (
        if /I "!WSL_DRIVE!"=="%%a" set "WSL_DRIVE=%%b"
    )
)
set "WSL_DIR=/mnt/!WSL_DRIVE!!WSL_PATH!"
wsl -e bash -lc "fuser -k 5176/tcp 8003/tcp || true"
wsl -e bash -lc "cd '%WSL_DIR%modern-app' && npm run dev:full"
timeout /t 4 >nul
start "" http://localhost:5176
endlocal
