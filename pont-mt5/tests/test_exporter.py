"""Tests du pont MT5, contre le faux module de stub/.

    python -m unittest discover -s pont-mt5/tests
"""
import importlib
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timezone

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ICI, "stub"))
sys.path.insert(0, os.path.dirname(ICI))

import exporter  # noqa: E402


def utc(texte):
    return datetime.strptime(texte, "%Y-%m-%dT%H:%M").replace(tzinfo=timezone.utc)


class HeureDuServeur(unittest.TestCase):
    def test_hiver_utc_plus_2_ete_utc_plus_3(self):
        # 15:30 serveur = 13:30 UTC en janvier, 12:30 UTC en juillet.
        self.assertEqual(exporter.iso(exporter.serveur_vers_utc(1768491000)), "2026-01-15T13:30:00Z")
        self.assertEqual(exporter.iso(exporter.serveur_vers_utc(1784129400)), "2026-07-15T12:30:00Z")

    def test_suit_l_heure_d_ete_americaine_pas_l_europeenne(self):
        # 2026 : l'Amérique passe à l'heure d'été le 8 mars, l'Europe le 29.
        # Le 16 mars, le serveur est déjà à UTC+3.
        self.assertTrue(exporter.heure_ete_new_york(utc("2026-03-16T12:00")))
        self.assertFalse(exporter.heure_ete_new_york(utc("2026-03-07T12:00")))
        # Fin : 1er novembre 2026, 6 h UTC.
        self.assertTrue(exporter.heure_ete_new_york(utc("2026-11-01T05:59")))
        self.assertFalse(exporter.heure_ete_new_york(utc("2026-11-01T06:00")))

    def test_minuit_serveur_est_17_h_a_new_york(self):
        # La convention NY+7 : la clôture de New York tombe à minuit serveur.
        minuit_ete = int(utc("2026-07-16T00:00").timestamp())
        self.assertEqual(exporter.iso(exporter.serveur_vers_utc(minuit_ete)), "2026-07-15T21:00:00Z")


class Export(unittest.TestCase):
    def lancer(self, *args, scenario="normal", decalage=None):
        os.environ["STUB_SCENARIO"] = scenario
        maintenant = datetime.now(timezone.utc)
        os.environ["STUB_DECALAGE"] = str(decalage if decalage is not None else exporter.decalage_regle(maintenant))
        sys.modules.pop("MetaTrader5", None)
        importlib.invalidate_caches()
        self.dossier = tempfile.mkdtemp()
        return exporter.main(["--sortie", self.dossier, *args])

    def lire(self, nom):
        with open(os.path.join(self.dossier, nom), encoding="utf-8") as f:
            return [json.loads(l) for l in f if l.strip()]

    def test_transactions_et_ordres_portent_leur_heure_utc(self):
        self.assertEqual(self.lancer(), 0)
        deals = self.lire("deals.jsonl")
        self.assertEqual(len(deals), 3)
        self.assertEqual(deals[1]["heureUtc"], "2026-07-15T12:30:00Z")
        self.assertEqual(deals[1]["position_id"], 77)
        ordres = self.lire("ordres.jsonl")
        self.assertEqual(ordres[0]["sl"], 3990.0)
        self.assertEqual(ordres[0]["miseEnPlaceUtc"], "2026-07-15T12:30:00Z")

    def test_compte_sans_identifiant_de_connexion(self):
        self.assertEqual(self.lancer(), 0)
        with open(os.path.join(self.dossier, "compte.json"), encoding="utf-8") as f:
            compte = json.load(f)
        self.assertEqual(compte["serveur"], "Axi-US51-Live")
        self.assertEqual(compte["verificationHeure"], "confirmée")
        self.assertNotIn("login", compte)

    def test_bougies_en_utc_au_format_du_lecteur_csv(self):
        self.assertEqual(self.lancer("--bougies", "XAUUSD"), 0)
        with open(os.path.join(self.dossier, "bougies", "XAUUSD_M1.csv"), encoding="utf-8") as f:
            lignes = f.read().splitlines()
        self.assertEqual(lignes[0], "time,open,high,low,close,volume")
        self.assertEqual(lignes[1], "2026-01-15T13:30:00Z,4000.0,4001.5,3999.0,4001.0,312")

    def test_refuse_quand_le_serveur_contredit_la_regle(self):
        mauvais = 2 if exporter.decalage_regle(datetime.now(timezone.utc)) == 3 else 3
        self.assertEqual(self.lancer(decalage=mauvais), 3)
        self.assertFalse(os.path.exists(os.path.join(self.dossier, "deals.jsonl")))

    def test_marche_ferme_n_empeche_pas_l_export_mais_le_dit(self):
        self.assertEqual(self.lancer(scenario="marche_ferme"), 0)
        with open(os.path.join(self.dossier, "compte.json"), encoding="utf-8") as f:
            self.assertTrue(json.load(f)["verificationHeure"].startswith("non vérifiable"))

    def test_terminal_ferme(self):
        self.assertEqual(self.lancer(scenario="terminal_ferme"), 2)

    def test_symbole_inconnu_propose_les_proches(self):
        self.assertEqual(self.lancer("--bougies", "GOLD"), 2)


if __name__ == "__main__":
    unittest.main()
