@echo off
echo.
echo  ==========================================
echo   AlphaLens - Multi-Agent Equity Research
echo  ==========================================
echo.
echo  Starting backend server...
echo  Open http://127.0.0.1:8000 in your browser
echo  Press Ctrl+C to stop
echo.
python -m uvicorn app.main:app --reload
