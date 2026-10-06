"""Faux module MetaTrader5, pour éprouver exporter.py sans terminal.

Reproduit la FORME des réponses du vrai paquet : des namedtuples pour les
transactions et les ordres, des enregistrements indexables par nom pour les
bougies, des heures en secondes « serveur ». Le contenu est fixé par
l'environnement STUB_SCENARIO.
"""
import os
import time
from collections import namedtuple

TIMEFRAME_M1, TIMEFRAME_M5, TIMEFRAME_M15, TIMEFRAME_M30 = 1, 5, 15, 30
TIMEFRAME_H1, TIMEFRAME_H4, TIMEFRAME_D1 = 16385, 16388, 16408

Deal = namedtuple("TradeDeal", "ticket order time time_msc type entry magic position_id reason volume price commission swap profit fee symbol comment external_id")
Ordre = namedtuple("TradeOrder", "ticket time_setup time_setup_msc time_done time_done_msc type state magic position_id volume_initial volume_current price_open sl tp price_current symbol comment")
Tick = namedtuple("Tick", "time bid ask")
Compte = namedtuple("AccountInfo", "login server currency leverage balance")
Symbole = namedtuple("SymbolInfo", "name")

SCENARIO = os.environ.get("STUB_SCENARIO", "normal")
# Décalage que le faux serveur applique à « maintenant » : 3 l'été américain, 2 l'hiver.
DECALAGE = int(os.environ.get("STUB_DECALAGE", "3"))

# 2026-07-15 15:30 heure serveur (UTC+3 l'été) = 12:30 UTC.
T_ETE = 1784129400  # 2026-07-15T15:30:00 encodé comme UTC
# 2026-01-15 15:30 heure serveur (UTC+2 l'hiver) = 13:30 UTC.
T_HIVER = 1768491000


def initialize(*a, **k):
    return SCENARIO != "terminal_ferme"


def shutdown():
    return True


def last_error():
    return (1, "stub")


def account_info():
    return Compte(123456, "Axi-US51-Live", "USD", 500, 1688.75)


def symbol_select(nom, activer=True):
    return nom in ("XAUUSD", "EURUSD")


def symbols_get(motif=None):
    return (Symbole("XAUUSD"), Symbole("XAUEUR"))


def symbol_info_tick(nom):
    if SCENARIO == "marche_ferme":
        return Tick(int(time.time()) - 3 * 86400, 0, 0)
    return Tick(int(time.time()) + DECALAGE * 3600, 4000.0, 4000.3)


def history_deals_get(depuis, jusqua):
    return (
        Deal(1, 0, T_HIVER - 86400, 0, 2, 0, 0, 0, 0, 0.0, 0.0, 0.0, 0.0, 1000.0, 0.0, "", "dépôt", ""),
        Deal(10, 100, T_ETE, 0, 0, 0, 0, 77, 0, 0.10, 4000.0, -0.35, 0.0, 0.0, 0.0, "XAUUSD", "OB 4h", ""),
        Deal(11, 101, T_ETE + 5400, 0, 1, 1, 0, 77, 4, 0.10, 4020.0, -0.35, -0.12, 200.0, 0.0, "XAUUSD", "[tp 4020.00]", ""),
    )


def history_orders_get(depuis, jusqua):
    return (
        Ordre(100, T_ETE, 0, T_ETE, 0, 0, 4, 0, 77, 0.10, 0.0, 4000.0, 3990.0, 4020.0, 4000.0, "XAUUSD", "OB 4h"),
        Ordre(101, T_ETE + 5400, 0, T_ETE + 5400, 0, 1, 4, 0, 77, 0.10, 0.0, 4020.0, 0.0, 0.0, 4020.0, "XAUUSD", "[tp 4020.00]"),
    )


def copy_rates_range(symbole, unite, depuis, jusqua):
    return [
        {"time": T_HIVER, "open": 4000.0, "high": 4001.5, "low": 3999.0, "close": 4001.0, "tick_volume": 312, "spread": 20, "real_volume": 0},
        {"time": T_HIVER + 60, "open": 4001.0, "high": 4002.0, "low": 4000.5, "close": 4000.8, "tick_volume": 198, "spread": 20, "real_volume": 0},
    ]
