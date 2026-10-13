@echo off
title Remnant 2 World Analyzer
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" %*
if errorlevel 1 pause
