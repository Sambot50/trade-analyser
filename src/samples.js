// Graphiques de démonstration.
//
// Les images sont des ressources statiques servies depuis /samples/, pas des
// data-URI inline : elles ne pèsent pas dans le bundle JS et sont mises en
// cache par le navigateur.
//
// Les repères "scale" sont ceux ayant réellement servi au tracé
// (scripts/make-samples.mjs) : l'overlay de la démo est donc exact au pixel,
// et sert de test de bout en bout de la projection prix -> pixel.

const PLOT_TOP_RATIO = 0.057143;
const PLOT_BOTTOM_RATIO = 0.885714;

export const SAMPLES = [
  {
    id: 'btc-m15',
    name: 'BTC/USDT (M15)',
    type: 'Crypto',
    src: `${import.meta.env.BASE_URL}samples/btc-m15.svg`,
    analysis: {
      symbol: 'BTC / USDT',
      timeframe: 'M15',
      bias: 'HAUSSIER',
      direction: 'BUY',
      entry: 64200.0,
      stopLoss: 63850.0,
      tp1: 64900.0,
      tp2: 65600.0,
      confidence: 91,
      reasoning: [
        "Rejet net sur l'Order Block M15 acheteur, avec balayage de liquidité sous le creux précédent.",
        "Fair Value Gap non comblé vers 64 800 $, laissé par l'impulsion haussière.",
        'Structure haute-temporalité alignée à la hausse après la cassure de structure H1.',
      ],
      scale: {
        priceTop: 65800,
        priceBottom: 63600,
        plotTopRatio: PLOT_TOP_RATIO,
        plotBottomRatio: PLOT_BOTTOM_RATIO,
      },
    },
  },
  {
    id: 'eurusd-h1',
    name: 'EUR/USD (H1)',
    type: 'Forex',
    src: `${import.meta.env.BASE_URL}samples/eurusd-h1.svg`,
    analysis: {
      symbol: 'EUR / USD',
      timeframe: 'H1',
      bias: 'BAISSIER',
      direction: 'SELL',
      entry: 1.085,
      stopLoss: 1.0885,
      tp1: 1.079,
      tp2: 1.072,
      confidence: 84,
      reasoning: [
        'Cassure de structure interne confirmée en H1 après la prise de liquidité Buy-side.',
        "Re-test de l'Order Block vendeur situé en zone premium.",
        'Extension visée sur la liquidité Sell-side, sous les plus bas de la séance.',
      ],
      scale: {
        priceTop: 1.092,
        priceBottom: 1.069,
        plotTopRatio: PLOT_TOP_RATIO,
        plotBottomRatio: PLOT_BOTTOM_RATIO,
      },
    },
  },
];
