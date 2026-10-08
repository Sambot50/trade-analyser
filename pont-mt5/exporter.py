#!/usr/bin/env python3
"""Pont MT5 : exporte l'historique du compte et des bougies, en UTC.

    python pont-mt5/exporter.py --sortie donnees/mt5
    python pont-mt5/exporter.py --sortie donnees/mt5 --bougies XAUUSD --depuis 2026-01-01

Prérequis, sur la machine où tourne le terminal MT5 (Windows) :

    pip install MetaTrader5

Le terminal doit être OUVERT et connecté au compte. Le script s'y attache ; il
ne demande ni ne stocke aucun mot de passe.

Ce que le script écrit dans --sortie :

    deals.jsonl     une ligne par transaction (ouvertures, clôtures, dépôts)
    ordres.jsonl    une ligne par ordre — c'est là que vivent le stop et
                    l'objectif posés À L'OUVERTURE
    compte.json     serveur, devise, levier, règle horaire et sa vérification
    bougies/<SYMBOLE>_<UT>.csv    si --bougies est donné

POURQUOI LA CONVERSION HORAIRE EST ICI, ET POURQUOI ELLE EST VÉRIFIÉE.
MT5 date tout à l'heure du SERVEUR du courtier, encodée comme si c'était de
l'UTC. Chez Axi, le serveur vit à l'heure de New York + 7 h : UTC+2 l'hiver,
UTC+3 pendant l'heure d'été américaine. Un décalage fixe serait faux la moitié
de l'année, et faux sans erreur visible : toutes les heures de trading du
journal seraient décalées d'une heure, et « ta meilleure heure » aussi.
La règle est donc appliquée date par date, puis CONFRONTÉE au serveur réel au
moment de l'export : si le décalage mesuré la contredit, l'export est refusé.

Rien ne quitte la machine. Le dossier donnees/ est exclu de git.

NON VÉRIFIÉ depuis l'environnement d'écriture : le paquet MetaTrader5 ne
tourne que sous Windows avec un terminal. Le script est éprouvé contre un faux
module (tests/stub/MetaTrader5.py) ; la rencontre avec le vrai terminal ne
l'est pas.
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone

REGLE = "NY+7"

UNITES = {
    "M1": "TIMEFRAME_M1", "M5": "TIMEFRAME_M5", "M15": "TIMEFRAME_M15",
    "M30": "TIMEFRAME_M30", "H1": "TIMEFRAME_H1", "H4": "TIMEFRAME_H4", "D1": "TIMEFRAME_D1",
}


# --- Heure du serveur -------------------------------------------------------

def _dimanche(annee, mois, rang):
    """Le rang-ième dimanche du mois, à 00:00 UTC."""
    premier = datetime(annee, mois, 1, tzinfo=timezone.utc)
    return premier + timedelta(days=(6 - premier.weekday()) % 7 + 7 * (rang - 1))


def heure_ete_new_york(utc):
    """Heure d'été américaine : du 2e dimanche de mars 2 h au 1er dimanche de novembre 2 h, heure de New York."""
    debut = _dimanche(utc.year, 3, 2) + timedelta(hours=7)   # 2 h EST = 7 h UTC
    fin = _dimanche(utc.year, 11, 1) + timedelta(hours=6)    # 2 h EDT = 6 h UTC
    return debut <= utc < fin


def decalage_regle(utc):
    """Décalage du serveur sur l'UTC, en heures, selon la règle NY+7."""
    return 3 if heure_ete_new_york(utc) else 2


def serveur_vers_utc(secondes):
    """Une heure serveur MT5 (secondes, encodées comme de l'UTC) vers le vrai UTC."""
    for dec in (3, 2):
        utc = datetime.fromtimestamp(secondes - dec * 3600, tz=timezone.utc)
        if decalage_regle(utc) == dec:
            return utc
    # L'heure qui n'existe pas au passage à l'heure d'été : aucune des deux
    # lectures n'est cohérente. On garde l'hiver, et c'est une heure par an.
    return datetime.fromtimestamp(secondes - 2 * 3600, tz=timezone.utc)


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def verifier_regle(mt5, symbole_reference, maintenant=None):
    """Confronte la règle au serveur : rend (decalage_mesure, verdict)."""
    maintenant = maintenant if maintenant is not None else time.time()
    tick = mt5.symbol_info_tick(symbole_reference) if symbole_reference else None
    if tick is None:
        return None, "non vérifiable : aucun cours pour " + str(symbole_reference)
    ecart = (tick.time - maintenant) / 3600
    mesure = round(ecart)
    # Un cours vieux de plus d'une demi-heure : marché fermé, la mesure ne vaut rien.
    if abs(ecart - mesure) * 3600 > 1800 or mesure not in (2, 3):
        return None, "non vérifiable : marché fermé ou cours ancien"
    attendu = decalage_regle(datetime.fromtimestamp(maintenant, tz=timezone.utc))
    if mesure != attendu:
        return mesure, f"CONTREDITE : serveur à UTC+{mesure}, la règle {REGLE} dit UTC+{attendu}"
    return mesure, "confirmée"


# --- Export -----------------------------------------------------------------

def _date(texte):
    return datetime.strptime(texte, "%Y-%m-%d").replace(tzinfo=timezone.utc)


def _ecrire_jsonl(chemin, lignes):
    with open(chemin, "w", encoding="utf-8", newline="\n") as f:
        for ligne in lignes:
            f.write(json.dumps(ligne, ensure_ascii=False) + "\n")


def exporter_trades(mt5, sortie, depuis, jusqua):
    deals = mt5.history_deals_get(depuis, jusqua) or ()
    ordres = mt5.history_orders_get(depuis, jusqua) or ()
    lignes_deals = []
    for d in deals:
        x = d._asdict()
        x["heureUtc"] = iso(serveur_vers_utc(x["time"]))
        lignes_deals.append(x)
    lignes_ordres = []
    for o in ordres:
        x = o._asdict()
        x["miseEnPlaceUtc"] = iso(serveur_vers_utc(x["time_setup"]))
        if x.get("time_done"):
            x["executionUtc"] = iso(serveur_vers_utc(x["time_done"]))
        lignes_ordres.append(x)
    _ecrire_jsonl(os.path.join(sortie, "deals.jsonl"), lignes_deals)
    _ecrire_jsonl(os.path.join(sortie, "ordres.jsonl"), lignes_ordres)
    return len(lignes_deals), len(lignes_ordres)


def resoudre_symbole(mt5, demande):
    """Le symbole exact chez le courtier. Axi peut suffixer : XAUUSD, XAUUSD.s…"""
    if mt5.symbol_select(demande, True):
        return demande, []
    proches = [s.name for s in (mt5.symbols_get("*" + demande + "*") or ())]
    return None, proches


def exporter_bougies(mt5, sortie, symbole, unite, depuis, jusqua):
    taux = mt5.copy_rates_range(symbole, getattr(mt5, UNITES[unite]), depuis, jusqua)
    if taux is None or len(taux) == 0:
        raise RuntimeError(f"aucune bougie {unite} pour {symbole} : {mt5.last_error()}")
    dossier = os.path.join(sortie, "bougies")
    os.makedirs(dossier, exist_ok=True)
    chemin = os.path.join(dossier, f"{symbole}_{unite}.csv")
    with open(chemin, "w", encoding="utf-8", newline="\n") as f:
        # Format « générique » de src/lib/marche/csv.js : horodatage ISO en UTC.
        # Le volume est le nombre de ticks : un CFD n'a pas de volume échangé.
        f.write("time,open,high,low,close,volume\n")
        for r in taux:
            f.write(f"{iso(serveur_vers_utc(int(r['time'])))},{r['open']},{r['high']},{r['low']},{r['close']},{int(r['tick_volume'])}\n")
    return chemin, len(taux)


def main(argv=None):
    p = argparse.ArgumentParser(description="Exporte l'historique MT5 et des bougies, en UTC.")
    p.add_argument("--sortie", required=True)
    p.add_argument("--depuis", default="2000-01-01", help="AAAA-MM-JJ")
    p.add_argument("--jusqua", default=None, help="AAAA-MM-JJ, défaut : demain")
    p.add_argument("--bougies", default=None, help="symbole, ex. XAUUSD")
    p.add_argument("--ut", default="M1", choices=sorted(UNITES))
    p.add_argument("--reference", default="XAUUSD", help="symbole servant à vérifier l'heure du serveur")
    p.add_argument("--forcer-regle", action="store_true",
                   help="exporter même si l'heure du serveur contredit la règle (déconseillé)")
    a = p.parse_args(argv)

    try:
        import MetaTrader5 as mt5
    except ImportError:
        print("Paquet MetaTrader5 absent : pip install MetaTrader5 (Windows, terminal MT5 installé).", file=sys.stderr)
        return 2

    if not mt5.initialize():
        print(f"Terminal MT5 injoignable : {mt5.last_error()}. Ouvre MT5 et connecte-toi au compte.", file=sys.stderr)
        return 2
    try:
        os.makedirs(a.sortie, exist_ok=True)
        depuis = _date(a.depuis)
        jusqua = _date(a.jusqua) if a.jusqua else datetime.now(timezone.utc) + timedelta(days=1)

        reference, _ = resoudre_symbole(mt5, a.reference)
        mesure, verdict = verifier_regle(mt5, reference)
        print(f"Heure du serveur : règle {REGLE}, {verdict}")
        if verdict.startswith("CONTREDITE") and not a.forcer_regle:
            print("Export refusé : toutes les heures du journal seraient fausses. Signale-le avant de forcer.", file=sys.stderr)
            return 3

        compte = mt5.account_info()
        n_deals, n_ordres = exporter_trades(mt5, a.sortie, depuis, jusqua)
        print(f"{n_deals} transactions, {n_ordres} ordres → {a.sortie}")

        if a.bougies:
            symbole, proches = resoudre_symbole(mt5, a.bougies)
            if not symbole:
                print(f"Symbole {a.bougies} introuvable. Proches : {', '.join(proches) or 'aucun'}", file=sys.stderr)
                return 2
            chemin, n = exporter_bougies(mt5, a.sortie, symbole, a.ut, depuis, jusqua)
            print(f"{n} bougies {a.ut} {symbole} → {chemin}")

        with open(os.path.join(a.sortie, "compte.json"), "w", encoding="utf-8") as f:
            json.dump({
                "serveur": getattr(compte, "server", None),
                "devise": getattr(compte, "currency", None),
                "levier": getattr(compte, "leverage", None),
                "exporteLe": iso(datetime.now(timezone.utc)),
                "depuis": iso(depuis), "jusqua": iso(jusqua),
                "regleHeure": REGLE, "decalageMesureH": mesure, "verificationHeure": verdict,
            }, f, ensure_ascii=False, indent=2)
        return 0
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    sys.exit(main())
