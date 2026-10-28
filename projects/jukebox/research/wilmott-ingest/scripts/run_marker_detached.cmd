@echo off
rem Runs the marker conversion detached from the calling shell (started via WMI Win32_Process.Create).
rem Usage: run_marker_detached.cmd [convert_marker.py args...]   (run from anywhere)
cd /d "%~dp0..\..\.."
set PYTHONIOENCODING=utf-8
".venv\Scripts\python.exe" -X faulthandler research\wilmott-ingest\scripts\convert_marker.py %* > research\wilmott-ingest\work\marker_run.log 2> research\wilmott-ingest\work\marker_run.err
echo %ERRORLEVEL% > research\wilmott-ingest\work\marker_run.exit
