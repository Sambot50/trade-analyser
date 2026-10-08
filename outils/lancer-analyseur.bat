@echo off
rem Lance l'analyseur et ouvre le navigateur quand il est prêt.
rem Fenêtre à laisser ouverte : la fermer arrête l'analyseur.
cd /d "%~dp0.."
rem Argument facultatif : la page à ouvrir, ex. /#feuille-de-route
call npm run dev -- --open %1
