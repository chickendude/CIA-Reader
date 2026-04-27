import { NLP_SERVICE_URL } from './env.js';

export interface LemmaCandidate {
  lemma: string;
  pos: string;
  score: number;
  features: Record<string, string>;
}

export interface NlpToken {
  idx: number;
  surface: string;
  is_word: boolean;
  candidates: LemmaCandidate[];
  is_ambiguous: boolean;
  is_oov: boolean;
  romanization: string | null;
}

export interface ProcessResponse {
  language: string;
  pipeline_id: string;
  tokens: NlpToken[];
}

export interface HealthResponse {
  status: string;
  languages: string[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(new URL(path, NLP_SERVICE_URL), {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`NLP service ${res.status}: ${body || res.statusText}`);
  }
  return (await res.json()) as T;
}

export const nlpClient = {
  health(): Promise<HealthResponse> {
    return request<HealthResponse>('/health');
  },
  process(language: string, text: string): Promise<ProcessResponse> {
    return request<ProcessResponse>('/process', {
      method: 'POST',
      body: JSON.stringify({ language, text }),
    });
  },
};
