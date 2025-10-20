@echo off
REM Vaihda tähän kansio, jossa HTML/PWA-tiedostosi sijaitsevat
cd /d "%~dp0"

REM Näytä koneen paikallinen IP-osoite (esim. 192.168.1.123)
echo Your local IP addresses:
ipconfig | findstr /i "IPv4"

REM Käynnistä Pythonin HTTP-palvelin portissa 8004
echo Starting Python HTTP server for Rush Hour at port 8004...
python -m http.server 8004 --bind 0.0.0.0

pause
