# Crée sur le bureau Windows les raccourcis de l'analyseur.
#
#   powershell -ExecutionPolicy Bypass -File outils\creer-raccourcis.ps1
#
#   « Trade Analyser »            lance l'analyseur et ouvre le navigateur
#   « Feuille de route »          ouvre l'analyseur directement sur la feuille de route
#   « Feuille de route (GitHub) » la même, lisible sans lancer l'analyseur
#
# Relancer le script remplace les raccourcis existants. Rien d'autre n'est
# modifié sur la machine.
#
# Enregistré en UTF-8 AVEC marqueur (BOM) : sans lui, PowerShell 5 lit le
# fichier comme du texte Windows ancien et casse les accents (« crÃ©Ã©s »).
#
# Lancé une première fois par l'opérateur le 2026-10-06 : les trois raccourcis
# sont créés. Leur fonctionnement reste à confirmer.

$ErrorActionPreference = 'Stop'
$racine = Split-Path -Parent $PSScriptRoot
$bureau = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell

$lanceur = $shell.CreateShortcut((Join-Path $bureau 'Trade Analyser.lnk'))
$lanceur.TargetPath = Join-Path $racine 'outils\lancer-analyseur.bat'
$lanceur.WorkingDirectory = $racine
$lanceur.Description = "Lance l'analyseur (laisser la fenêtre ouverte)"
$lanceur.Save()

# Ouvre l'analyseur sur l'onglet Feuille de route. Il doit être lancé.
$feuille = $shell.CreateShortcut((Join-Path $bureau 'Feuille de route.lnk'))
$feuille.TargetPath = Join-Path $racine 'outils\lancer-analyseur.bat'
$feuille.Arguments = '/#feuille-de-route'
$feuille.WorkingDirectory = $racine
$feuille.Description = "Lance l'analyseur sur la feuille de route"
$feuille.Save()

Set-Content -Path (Join-Path $bureau 'Feuille de route (GitHub).url') -Encoding ASCII -Value @(
  '[InternetShortcut]',
  'URL=https://github.com/Sambot50/trade-analyser/blob/main/docs/FEUILLE-DE-ROUTE.md'
)

Write-Host "Raccourcis créés sur $bureau :"
Write-Host '  Trade Analyser'
Write-Host '  Feuille de route'
Write-Host '  Feuille de route (GitHub)'
