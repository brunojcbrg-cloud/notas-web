// Sessão ativa do notas-web: qual repositório, branch e pasta de notas o
// cliente fala agora. Fase 3 (§3.3): antes disso REPO/BRANCH/PASTA eram
// constantes fixas em github.ts, soldadas no vault do Bruno. Continuam
// tendo um padrão (o vault dele), mas passam a poder ser trocadas por um
// passe.json de outra pessoa depois do login Google.

export interface Sessao {
  repo: string;
  branch: string;
  pasta: string;
}

const PADRAO: Sessao = {
  repo: 'brunojcbrg-cloud/vault-conhecimento',
  branch: 'master',
  pasta: '06_Conhecimento/',
};

let atual: Sessao = { ...PADRAO };

export function sessaoPadrao(): Sessao {
  return { ...PADRAO };
}

export function sessaoAtual(): Sessao {
  return atual;
}

export function repoAtual(): string {
  return atual.repo;
}

export function branchAtual(): string {
  return atual.branch;
}

export function pastaAtual(): string {
  return atual.pasta;
}

/** Troca a sessão ativa (ex.: depois de validar um passe.json). */
export function definirSessao(sessao: Sessao): void {
  atual = { ...sessao };
}

/** Volta para o vault do Bruno — usado por testes e pelo botão de sair. */
export function redefinirSessaoPadrao(): void {
  atual = { ...PADRAO };
}
