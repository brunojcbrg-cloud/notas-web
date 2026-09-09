export const CHAVE_TOKEN = 'notas-web.github-token';

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

export function sair(storage: ArmazenamentoSessao): 'entrada' {
  storage.clear();
  return 'entrada';
}
