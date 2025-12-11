@echo off
echo Starting BroTeam Translate Bot...
pm2 start ecosystem.config.js
echo Bot started. Use 'pm2 logs broteam-translate-bot' to view logs.
pause