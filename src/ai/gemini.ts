import { parseModelJson } from './blocks';
import type { Block } from './blocks';
import { RESPONSE_SCHEMA, SYSTEM_PROMPT, userPrompt } from './prompt';

/**
 * Modèles du niveau gratuit de l'API Gemini, dans l'ordre d'essai en cas de surcharge ou de modèle
 * introuvable. Chacun a son propre quota. `gemini-1.5-flash` en dernier recours : c'est le plus
 * ancien et le plus largement disponible, il reste accessible même quand un nom plus récent a été
 * retiré ou renommé par Google.
 */
export const FREE_MODELS = ['gemini-3.8-flash', 'gemini-3.8', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash-lite', 'gemini-1.5-flash'];

const REQUEST_TIMEOUT_MS = 90_000;
// On essaie toute la liste : un modèle « introuvable » (nom retiré ou renommé côté Google) ne doit
// jamais faire échouer la conversion tant qu'un autre, dans la liste, répond encore.
const MAX_MODELS = FREE_MODELS.length;

export type ErrorKind =
  | 'key'
  | 'quota'
  | 'rate'
  | 'overloaded'
  | 'timeout'
  | 'network'
  | 'model'
  | 'blocked'
  | 'format'
  | 'request'
  | 'server';

export class ConversionError extends Error {
  kind: ErrorKind;
  retryAfterMs: number;
  constructor(kind: ErrorKind, message: string, retryAfterMs = 0) {
    super(message);
    this.kind = kind;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface ConvertRequest {
  apiKey: string;
  model: string;
  autoFallback: boolean;
  base64: string;
  mimeType: string;
  subject: string;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
}

export interface ConvertResult {
  blocks: Block[];
  model: string;
  attempts: number;
}

interface GoogleErrorDetail {
  '@type'?: string;
  retryDelay?: string;
  violations?: { quotaId?: string }[];
}
interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string; details?: GoogleErrorDetail[] };
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/**
 * Convertit une image avec Gemini. Les erreurs passagères (503 « surchargé ») sont réessayées une
 * fois, puis on passe au modèle gratuit suivant. Chaque essai compte dans le quota : on s'arrête à 3 modèles.
 */
export async function convertWithGemini(req: ConvertRequest): Promise<ConvertResult> {
  const chain = req.autoFallback
    ? [req.model, ...FREE_MODELS.filter((m) => m !== req.model)].slice(0, MAX_MODELS)
    : [req.model];
  let attempts = 0;
  let lastError: ConversionError | null = null;

  for (const [index, model] of chain.entries()) {
    if (index > 0 && lastError) {
      const why = lastError.kind === 'quota' || lastError.kind === 'rate' ? 'Quota atteint' : 'Toujours surchargé';
      req.onStatus?.(`${why} : essai avec ${model}…`);
    }
    for (let retry = 0; ; retry++) {
      attempts++;
      try {
        const blocks = await callModel(model, req);
        return { blocks, model, attempts };
      } catch (e) {
        if (!(e instanceof ConversionError)) throw e;
        lastError = e;
        const transient = e.kind === 'overloaded' || e.kind === 'server' || e.kind === 'timeout';
        if (transient && retry === 0) {
          const wait = 2500 + Math.random() * 1500;
          req.onStatus?.(`Gemini est surchargé, nouvel essai dans ${Math.round(wait / 1000)} s…`);
          await sleep(wait, req.signal);
          continue;
        }
        if (e.kind === 'rate' && retry === 0 && e.retryAfterMs <= 40_000) {
          req.onStatus?.(`Limite par minute atteinte, reprise dans ${Math.ceil(e.retryAfterMs / 1000)} s…`);
          await sleep(e.retryAfterMs, req.signal);
          continue;
        }
        if (transient || e.kind === 'rate' || e.kind === 'quota' || e.kind === 'model') break; // modèle suivant
        throw e;
      }
    }
  }

  if (lastError && (lastError.kind === 'overloaded' || lastError.kind === 'server' || lastError.kind === 'timeout')) {
    throw new ConversionError(
      'overloaded',
      `Gemini est surchargé en ce moment (essayé : ${chain.join(', ')}). Ce n'est pas ton code : réessaie dans une minute.`,
    );
  }
  if (lastError && lastError.kind === 'model' && chain.length > 1) {
    // Google retire ou renomme parfois un modèle : ce n'est pas la clé qui est en cause, juste son nom.
    throw new ConversionError(
      'model',
      `Aucun des modèles essayés n'a répondu (${chain.join(', ')}) : Google les a peut-être renommés ou retirés. ` +
        `Choisis-en un autre dans Réglages → Gemini → Modèle (la liste vient d'être mise à jour), ou vérifie la liste ` +
        `à jour sur ai.google.dev/gemini-api/docs/models.`,
    );
  }
  throw lastError ?? new ConversionError('server', 'Échec de la conversion.');
}

async function callModel(model: string, req: ConvertRequest): Promise<Block[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = (withSchema: boolean) => ({
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [
      {
        role: 'user',
        parts: [{ inlineData: { mimeType: req.mimeType, data: req.base64 } }, { text: userPrompt(req.subject) }],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      ...(withSchema ? { responseSchema: RESPONSE_SCHEMA } : {}),
      maxOutputTokens: 8192,
    },
  });
  const post = async (withSchema: boolean) => {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
    try {
      return await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': req.apiKey },
        body: JSON.stringify(body(withSchema)),
        signal,
      });
    } catch (e) {
      if (req.signal?.aborted) throw e;
      if ((e as Error).name === 'TimeoutError') throw new ConversionError('timeout', 'Gemini ne répond pas (délai dépassé).');
      throw new ConversionError('network', 'Impossible de joindre Gemini. Vérifie ta connexion internet.');
    }
  };

  let res = await post(true);
  let data = (await res.json().catch(() => ({}))) as GeminiResponse;
  if (res.status === 400 && /schema/i.test(data.error?.message ?? '')) {
    // Certains modèles refusent le schéma : on redemande en JSON libre
    res = await post(false);
    data = (await res.json().catch(() => ({}))) as GeminiResponse;
  }
  if (!res.ok) throw httpError(res.status, data, model);

  const candidate = data.candidates?.[0];
  if (!candidate) {
    const reason = data.promptFeedback?.blockReason;
    throw new ConversionError('blocked', `Gemini n'a rien renvoyé${reason ? ` (blocage : ${reason})` : ''}.`);
  }
  const text = (candidate.content?.parts ?? [])
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('');
  if (!text.trim()) {
    throw new ConversionError('blocked', `Réponse vide de Gemini (fin : ${candidate.finishReason ?? 'inconnue'}).`);
  }
  try {
    return parseModelJson(text);
  } catch (e) {
    const cut = candidate.finishReason === 'MAX_TOKENS' ? ' La réponse a été coupée : sélectionne une zone plus petite.' : '';
    throw new ConversionError('format', `${(e as Error).message}.${cut}`);
  }
}

function httpError(status: number, data: GeminiResponse, model: string): ConversionError {
  const message = data.error?.message ?? '';
  if (status === 429) {
    const details = data.error?.details ?? [];
    const delay = Number.parseFloat(details.find((d) => d['@type']?.includes('RetryInfo'))?.retryDelay ?? '');
    const retryAfterMs = Number.isFinite(delay) ? Math.ceil(delay * 1000) : 30_000;
    const perDay = details.some((d) => d.violations?.some((v) => /PerDay/i.test(v.quotaId ?? '')));
    if (perDay) {
      return new ConversionError(
        'quota',
        `Quota gratuit du jour atteint pour ${model}. Choisis un autre modèle dans les réglages, ou réessaie demain.`,
        retryAfterMs,
      );
    }
    return new ConversionError('rate', `Trop de requêtes par minute pour ${model}.`, retryAfterMs);
  }
  if (status === 400 && /api key/i.test(message)) {
    return new ConversionError('key', 'Clé API invalide. Vérifie-la dans les réglages.');
  }
  if (status === 401 || status === 403) {
    return new ConversionError('key', `Clé API refusée (${status}). ${message}`);
  }
  if (status === 404) {
    return new ConversionError('model', `Modèle « ${model} » introuvable.`);
  }
  if (status === 503) {
    return new ConversionError('overloaded', `Gemini est surchargé (${model}).`);
  }
  if (status >= 500) {
    return new ConversionError('server', `Erreur du serveur Gemini (${status}).`);
  }
  return new ConversionError('request', `Erreur ${status} : ${message || 'inconnue'}`);
}
