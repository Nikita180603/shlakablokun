@echo off
rem Запуск бэкапа из Планировщика: рабочая папка сайта фиксированная.
cd /d "C:\Users\zeid8\OneDrive\Desktop\папка_с_проэктами\plitka_i_shlakablokyn"
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\zeid8\OneDrive\Desktop\папка_с_проэктами\plitka_i_shlakablokyn\deploy\backup.ps1"
