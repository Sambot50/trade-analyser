# Obtenir des données — or, forex, indices

Binance ne cote ni l'or, ni le forex, ni les indices. Pour mesurer quoi que ce
soit sur XAUUSD, il faut un fichier. Ce document dit lequel, où, et quel piège
évite de décaler toute la série de cinq heures sans qu'aucune erreur ne le
signale.

## Un seul fichier suffit

Télécharge du **1 minute**, et rien d'autre. Le backtest en déduit les bougies
5 minutes, 15 minutes et 1 heure par agrégation exacte.

Télécharger trois fichiers séparés expose à trois périodes qui ne se
recouvrent pas — un décalage qui ne lève aucune exception et fausse
silencieusement le filtre de biais.

## Où télécharger

### HistData.com — recommandé pour commencer

Gratuit, sans compte, sans clé. Couvre XAUUSD, les paires forex majeures et
quelques indices, en 1 minute, sur une vingtaine d'années.

1. https://www.histdata.com/download-free-forex-data/
2. Format : **ASCII / M1 Bars** (pas « tick », pas « MT »)
3. Instrument : **XAUUSD**, puis l'année voulue
4. Décompresser : un `.csv` par année

Format des lignes, point-virgule, sans en-tête :

```
20250102 000000;2062.51;2063.11;2062.19;2062.65;0
```

**Le piège :** HistData horodate en **EST, sans heure d'été** — un fuseau qui
n'existe nulle part sur un calendrier. Sans correction, toute la série est
décalée de cinq heures, ce qui déplace les bougies 1 heure d'autant et fausse
le biais. D'où `--decalage-heures -5`.

**La limite :** la colonne volume vaut toujours 0 sur le forex et l'or. Aucune
analyse de volume n'est possible sur ces fichiers, et le backtest le dit
plutôt que de produire un chiffre.

### Export MetaTrader — pour coller à ton courtier

Si tu as MT4 ou MT5 chez Vantage, ses propres bougies valent mieux que celles
d'un agrégateur : ce sont les prix auxquels tu aurais été exécuté.

MT5 → Outils → Centre d'historique → XAUUSD → M1 → Exporter.

Le fichier sort en `<DATE>,<TIME>,<OPEN>,...`, avec un en-tête et un volume de
ticks réel. Il est lu directement, sans option. Son horodatage est celui du
serveur du courtier, souvent UTC+2 ou UTC+3 : vérifie, et corrige avec
`--decalage-heures`.

### Ce qu'aucune de ces sources ne donnera : le volume

Le forex et les CFD sont **décentralisés**. Il n'y a pas de bourse centrale,
donc pas de volume total, et **aucune ventilation acheteur/vendeur**. Ce que
MT5 affiche comme « volume » est le *tick volume* — un comptage de changements
de prix, pas une quantité échangée.

Toute la narration SMC sur « l'empreinte institutionnelle » et le pic de volume
qui valide un order block est donc **non mesurable** sur ces fichiers. Pas
difficile à mesurer : impossible.

Binance, elle, donne le volume acheteur agressif gratuitement. Pour l'or, la
seule source réelle est **COMEX**, et c'est désormais celle du test
pré-enregistré : voir DEC-027 et la section ci-dessous.

### Dukascopy — pour la profondeur d'historique

Gratuit, plus complet, mais nécessite leur outil d'export. À réserver au moment
où l'année d'historique ne suffira plus.

## Le test pré-enregistré sur l'or (DEC-026, amendé par DEC-027)

**La source HistData est abandonnée pour ce test.** Le flux spot d'un
agrégateur n'est pas auditable et ne porte aucun volume ; l'or se mesure sur
COMEX, la bourse où il s'échange réellement. Les deux sections précédentes
restent valables pour tout autre usage.

### La source

| | |
|---|---|
| Fournisseur | Databento |
| Dataset | `GLBX.MDP3` (CME Globex, COMEX compris) |
| Schéma | `ohlcv-1m` |
| Symbole | `GC.v.0` — contrat continu, roulement au volume |
| Période | 2023-01-01 → 2024-12-31 |

**125 $ de crédit sont offerts à l'inscription.** `ohlcv-1m` est le schéma le
moins cher du catalogue et la console affiche le coût avant de confirmer le
téléchargement : lis-le, il n'y a aucune raison d'être surpris par une facture.

**La clé API ne se colle nulle part d'autre que dans `.env.local`**, qui est
ignoré par Git. Si elle a transité par une conversation, un ticket ou un
message, elle est à révoquer et à régénérer.

### Ce que `GC.v.0` fait, et ce qu'il ne fait pas

Il **désigne** à chaque instant le contrat le plus actif et bascule
automatiquement au roulement. Il n'**ajuste** rien : les prix sont bruts, et il
y a donc un saut à chaque changement de contrat.

C'est voulu, chez eux comme chez nous. Un ajustement opaque introduirait des
erreurs qu'on ne pourrait pas auditer, et notre protocole entier consiste à
refuser ça.

### Le découpage par contrat — la règle qui rend la mesure valide

**On ne construit jamais de série continue, et on ne recolle rien.**

Chaque ligne de l'export porte le symbole du contrat réel. On découpe dès que
ce champ change, on fait tourner la chaîne complète sur chaque segment, et on
met les issues en commun à la fin.

Un recollage naïf ferait lire le saut de prix comme un déplacement suivi d'une
cassure de structure — c'est-à-dire qu'il fabriquerait de faux order blocks
exactement là où on en cherche des vrais.

Les order blocks à moins de 48 h d'une frontière de contrat sont écartés :
l'horizon de résolution n'y tient pas. Environ 3 % de la période, annoncés
d'avance.

### Étape 1 — l'échantillon, avant tout le reste

Avant le téléchargement complet, **une seule journée** de `GC.v.0` en
`ohlcv-1m`, n'importe laquelle en 2023.

La forme exacte de l'export n'est pas connue, et le piège est réel : selon le
client utilisé, les prix sortent en flottants ou en **entiers au milliardième**.
Un importateur écrit sans avoir vu le fichier est un importateur écrit deux
fois.

### Étape 2 — le téléchargement complet

Par la console Databento, ou par leur client Python :

```python
import databento as db
import os

client = db.Historical(os.environ['DATABENTO_API_KEY'])  # jamais la clé en clair

donnees = client.timeseries.get_range(
    dataset='GLBX.MDP3',
    schema='ohlcv-1m',
    symbols='GC.v.0',
    stype_in='continuous',
    start='2023-01-01',
    end='2025-01-01',
)
donnees.to_csv('GC_2023_2024.csv')
```

### Étape 3 — la mesure

La commande n'est pas encore écrite : le découpage par contrat n'existe pas
dans `scripts/backtest.mjs`. Elle sera figée ici une fois l'importateur et le
découpage en place et testés, avec la configuration gelée par DEC-026 —
`--ut-biais 4h --ut-detection 1h --ut-resolution 5m --objectif 1r
--remplissage cloture --fenetre 5 --horizon-heures 48 --cout-en-r 0
--controle 200`.

**Trois lignes à vérifier avant de croire quoi que ce soit** : le nombre de
bougies, la période couverte, et le **nombre de contrats détectés** — une
douzaine sur deux ans. Un seul contrat signalerait que le découpage n'a pas
fonctionné, et la mesure serait à jeter.

## Lancer la mesure

```bash
# Or, une année, spread Vantage annoncé à 0,25 $
node scripts/backtest.mjs \
  --csv XAUUSD_M1_2025.csv \
  --symbole XAUUSD \
  --decalage-heures -5 \
  --spread 0.25
```

Options utiles :

| Option | Rôle | Défaut |
|---|---|---|
| `--csv` | fichier de bougies | — |
| `--ut-csv` | unité des lignes du fichier | `1m` |
| `--decalage-heures` | correction de fuseau, `-5` pour HistData | `0` |
| `--spread` | écart achat/vente, en unités de prix | `0` |
| `--commission` | coût additionnel par aller-retour, mêmes unités | `0` |
| `--depuis` / `--jusqua` | restreindre la période du fichier | bornes du fichier |
| `--ut-biais` / `--ut-detection` / `--ut-resolution` | unités de la chaîne | `1h` / `15m` / `5m` |

## Vérifier que le fichier est bien lu

Trois lignes de la sortie méritent un regard avant de croire le reste :

- **le nombre de bougies** et la **période couverte** — si elle ne correspond
  pas à ce que tu as téléchargé, le décalage horaire est faux ;
- **le taux de couverture** — autour de 70 % est normal sur le forex, qui ferme
  le week-end. Nettement moins signale un fichier troué ;
- **l'avertissement sur le volume**, s'il apparaît : le fichier n'en porte pas.

## Convertir le spread en unités de prix

`--spread` attend une **distance en prix**, pas des pips ni des points.

| Instrument | Spread affiché | À passer |
|---|---|---|
| XAUUSD | 25 points (0,25 $) | `--spread 0.25` |
| EURUSD | 1,2 pip | `--spread 0.00012` |
| BTCUSD CFD | 20 $ | `--spread 20` |

Pour un compte à commission, convertis le tarif au lot en distance de prix
équivalente et passe-le dans `--commission`. Chez Vantage en Raw ECN, 3 $ par
lot et par sens sur XAUUSD (1 lot = 100 onces) font 6 $ l'aller-retour, soit
0,06 $ par once : `--commission 0.06`.

**Le spread annoncé est le spread moyen.** Il double à l'ouverture de Londres
et à la clôture de New York, et pendant les publications macro. Mesurer avec
le spread moyen donne donc une borne optimiste, pas une prévision.
