export const CHAVE_TOKEN = 'notas-web.github-token';
// Fase 3, §3.5: token de acesso do Google (escopo drive.readonly, decidido
// em M0.3), guardado só em sessionStorage — nunca localStorage, igual ao
// token do GitHub, porque a UFES é máquina compartilhada.
export const CHAVE_TOKEN_GOOGLE = 'notas-web.google-token';

export interface ArmazenamentoSessao {
  getItem(chave: string): string | null;
  setItem(chave: string, valor: string): void;
  clear(): void;
}

export function guardarToken(storage: ArmazenamentoSessao, token: string): void {
  storage.setItem(CHAVE_TOKEN, token);
}

export function lerToken(storage: ArmazenamentoSessao): string | null {
  return storage.getItem(CHAVE_TOKEN);
}

export function guardarTokenGoogle(storage: ArmazenamentoSessao, token: string): void {
  storage.setItem(CHAVE_TOKEN_GOOGLE, token);
}

export function lerTokenGoogle(storage: ArmazenamentoSessao): string | null {
  return storage.getItem(CHAVE_TOKEN_GOOGLE);
}

export function sair(storage: ArmazenamentoSessao): 'entrada' {
  storage.clear();
  return 'entrada';
}
