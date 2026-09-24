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

Binance, elle, donne le volume acheteur agressif gratuitement — c'est pourquoi
l'hypothèse du volume se teste sur le crypto avant toute dépense. Pour l'or, la
seule source réelle est COMEX, et elle est payante : voir `PISTES.md`.

### Dukascopy — pour la profondeur d'historique

Gratuit, plus complet, mais nécessite leur outil d'export. À réserver au moment
où l'année d'historique ne suffira plus.

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
