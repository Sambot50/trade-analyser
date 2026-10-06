import { describe, it, expect, vi, afterEach } from 'vitest';

import * as anthropic from './anthropic.js';
import * as compatible from './compatible-openai.js';
import { ANALYSIS_SCHEMA } from './schema.js';
import { PROVIDERS, blockingReason } from './index.js';

const IMAGE = 'data:image/png;base64,iVBORw0KGgo=';
const PLAN = {
  symbol: 'X', timeframe: '15m', bias: 'BAISSIER', direction: 'SELL', entry: 3055, stopLoss: 3072, tp1: 3040, tp2: 3025,
  confidence: 70, reasoning: ['r'], scale: { priceTop: 3070, priceBottom: 3010, plotTopRatio: 0.09, plotBottomRatio: 0.84 },
};

afterEach(() => vi.unstubAllGlobals());

describe('Claude (Anthropic)', () => {
  it('impose l’outil dont le schéma est celui de l’analyse, image avant texte', () => {
    const { url, init } = anthropic.construireRequete(IMAGE, { apiKey: ' sk-ant-x ', model: 'claude-opus-5-5' });
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers).toMatchObject({ 'x-api-key': 'sk-ant-x', 'anthropic-version': '2023-06-01' });
    const corps = JSON.parse(init.body);
    expect(corps.model).toBe('claude-opus-5-5');
    expect(corps.tool_choice).toEqual({ type: 'tool', name: 'plan_de_trade' });
    expect(corps.tools[0].input_schema).toEqual(ANALYSIS_SCHEMA);
    expect(corps.messages[0].content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } });
  });

  it('lit le plan dans l’appel d’outil, et à défaut dans le texte', () => {
    expect(anthropic.lireReponse({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'plan_de_trade', input: PLAN }] })).toEqual(PLAN);
    expect(anthropic.lireReponse({ content: [{ type: 'text', text: JSON.stringify(PLAN) }] })).toEqual(PLAN);
  });

  it('refuse une réponse tronquée plutôt que de lire un plan incomplet', () => {
    expect(() => anthropic.lireReponse({ stop_reason: 'max_tokens', content: [] })).toThrow(/tronquée/);
  });

  it('exige une clé, et traduit les erreurs de l’API', async () => {
    expect(() => anthropic.construireRequete(IMAGE, {})).toThrow(/Clé API Anthropic/);
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: { message: 'x' } }), { status: 401 }));
    await expect(anthropic.analyzeChart(IMAGE, { apiKey: 'k' })).rejects.toThrow(/refusée \(401\)/);
  });
});

describe('Compatible OpenAI', () => {
  it('envoie l’image en data-URI et le schéma dans la consigne, la clé seulement s’il y en a une', () => {
    const avec = compatible.construireRequete(IMAGE, { apiKey: 'sk-1', model: 'pixtral-large-latest', baseUrl: 'https://api.mistral.ai/v1/' });
    expect(avec.url).toBe('https://api.mistral.ai/v1/chat/completions');
    expect(avec.init.headers.Authorization).toBe('Bearer sk-1');
    const corps = JSON.parse(avec.init.body);
    expect(corps.response_format).toEqual({ type: 'json_object' });
    expect(corps.messages[0].content).toContain('"stopLoss"');
    expect(corps.messages[1].content[1]).toEqual({ type: 'image_url', image_url: { url: IMAGE } });

    const local = compatible.construireRequete(IMAGE, { model: 'qwen', baseUrl: 'http://localhost:1234/v1' });
    expect(local.init.headers.Authorization).toBeUndefined();
  });

  it('lit le contenu, en texte ou en morceaux', () => {
    expect(compatible.lireReponse({ choices: [{ message: { content: JSON.stringify(PLAN) } }] })).toEqual(PLAN);
    expect(compatible.lireReponse({ choices: [{ message: { content: [{ type: 'text', text: JSON.stringify(PLAN) }] } }] })).toEqual(PLAN);
    expect(() => compatible.lireReponse({ choices: [{ finish_reason: 'length', message: { content: '{' } }] })).toThrow(/tronquée/);
  });

  it('réessaie une fois sans response_format quand le serveur le refuse', async () => {
    const corps = [];
    vi.stubGlobal('fetch', async (_url, init) => {
      const b = JSON.parse(init.body);
      corps.push(b);
      if (b.response_format) return new Response('{"error":{"message":"response_format not supported"}}', { status: 400 });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(PLAN) } }] }), { status: 200 });
    });
    await expect(compatible.analyzeChart(IMAGE, { model: 'm', baseUrl: 'http://localhost:1234/v1' })).resolves.toEqual(PLAN);
    expect(corps).toHaveLength(2);
    expect(corps[1].response_format).toBeUndefined();
  });

  it('dit que l’adresse est injoignable plutôt que de lever une erreur réseau brute', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch'); });
    await expect(compatible.analyzeChart(IMAGE, { model: 'm' })).rejects.toThrow(/injoignable/);
  });
});

describe('le registre, brique interchangeable', () => {
  it('décrit chaque fournisseur de la même façon', () => {
    for (const p of Object.values(PROVIDERS)) {
      expect(['aucune', 'optionnelle', 'requise']).toContain(p.keyPolicy);
      expect(typeof p.analyze).toBe('function');
      expect(p.defaultModel).toBeTruthy();
    }
  });

  it('bloque Claude sans clé, laisse passer un serveur local sans clé mais pas sans modèle', () => {
    expect(blockingReason('anthropic', { model: 'claude-sonnet-5-5' })).toMatch(/clé API/);
    expect(blockingReason('compatible', { model: 'qwen', baseUrl: 'http://localhost:1234/v1' })).toBeNull();
    expect(blockingReason('compatible', { model: ' ' })).toMatch(/modèle/);
  });
});
