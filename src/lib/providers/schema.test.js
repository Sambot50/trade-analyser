import { describe, it, expect } from 'vitest';
import { ANALYSIS_SCHEMA, toGeminiSchema, parseAnalysisJson } from './schema.js';
import { PROVIDERS, blockingReason, getProvider } from './index.js';

describe('toGeminiSchema', () => {
  const converted = toGeminiSchema(ANALYSIS_SCHEMA);

  it('met les types en majuscules', () => {
    expect(converted.type).toBe('OBJECT');
    expect(converted.properties.entry.type).toBe('NUMBER');
    expect(converted.properties.confidence.type).toBe('INTEGER');
    expect(converted.properties.reasoning.type).toBe('ARRAY');
    expect(converted.properties.reasoning.items.type).toBe('STRING');
  });

  it('conserve les énumérations', () => {
    expect(converted.properties.direction.enum).toEqual(['BUY', 'SELL']);
  });

  it('convertit le repère de prix imbriqué', () => {
    const scale = converted.properties.scale;
    expect(scale.type).toBe('OBJECT');
    expect(scale.properties.priceTop.type).toBe('NUMBER');
    expect(scale.required).toContain('plotBottomRatio');
  });

  it('exige le repère de prix au premier niveau', () => {
    expect(converted.required).toContain('scale');
  });

  it('ne mute pas le schéma canonique', () => {
    expect(ANALYSIS_SCHEMA.type).toBe('object');
    expect(ANALYSIS_SCHEMA.properties.entry.type).toBe('number');
  });
});

describe('parseAnalysisJson', () => {
  it('lit un JSON nu', () => {
    expect(parseAnalysisJson('{"entry":1}')).toEqual({ entry: 1 });
  });

  it('tolère les fences d’un modèle local', () => {
    expect(parseAnalysisJson('```json\n{"entry":2}\n```')).toEqual({ entry: 2 });
  });

  it('extrait l’objet noyé dans du bavardage', () => {
    expect(parseAnalysisJson('Voici mon analyse :\n{"entry":3}\nJ’espère que ça aide.'))
      .toEqual({ entry: 3 });
  });

  it('rejette une réponse vide', () => {
    expect(() => parseAnalysisJson('   ')).toThrow(/vide/);
  });

  it('rejette du texte sans JSON', () => {
    expect(() => parseAnalysisJson('je ne peux pas analyser cette image'))
      .toThrow(/JSON exploitable/);
  });
});

describe('registre des fournisseurs', () => {
  it('expose Ollama sans clé requise', () => {
    expect(PROVIDERS.ollama.needsApiKey).toBe(false);
  });

  it('laisse passer Ollama sans clé', () => {
    expect(blockingReason('ollama', {})).toBeNull();
  });

  it('bloque Gemini sans clé', () => {
    expect(blockingReason('gemini', { apiKey: '  ' })).toMatch(/clé API/);
  });

  it('laisse passer Gemini avec une clé', () => {
    expect(blockingReason('gemini', { apiKey: 'AIzaX' })).toBeNull();
  });

  it('refuse un fournisseur inconnu', () => {
    expect(() => getProvider('openai')).toThrow(/inconnu/);
  });
});
