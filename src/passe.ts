// Fase 3, §3.3: o passe.json que o Bruno provisiona no Drive de cada
// destinatária (roteiro em E:\CENTRAL\work\PROVISIONAR_USUARIO.md). Mesmo
// rigor de validação do manifesto de materiais (materiais.ts) — é conteúdo
// de terceiro lido por API, nunca confiança cega.

export interface Passe {
  versao: 1;
  usuario: string;
  nome: string;
  repo: string;
  branch: string;
  pastaNotas: string;
  token: string;
  materiaisFolderId: string;
}

const REPO_VALIDO = /^[\w.-]+\/[\w.-]+$/;
const ID_DRIVE_VALIDO = /^[\w-]+$/;

export class ErroPasse extends Error {}

export function validarPasse(valor: unknown): Passe {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new ErroPasse('passe.json inválido.');
  }
  const p = valor as Partial<Passe>;
  if (p.versao !== 1) throw new ErroPasse('passe.json de versão desconhecida.');
  if (typeof p.usuario !== 'string' || !p.usuario.includes('@')) {
    throw new ErroPasse('passe.json sem usuário válido.');
  }
  if (typeof p.nome !== 'string' || !p.nome.trim()) throw new ErroPasse('passe.json sem nome.');
  if (typeof p.repo !== 'string' || !REPO_VALIDO.test(p.repo)) {
    throw new ErroPasse('passe.json com repositório inválido.');
  }
  if (typeof p.branch !== 'string' || !p.branch.trim()) throw new ErroPasse('passe.json sem branch.');
  if (
    typeof p.pastaNotas !== 'string' ||
    !p.pastaNotas.endsWith('/') ||
    p.pastaNotas.startsWith('/') ||
    p.pastaNotas.includes('..') ||
    p.pastaNotas.includes('\\')
  ) {
    throw new ErroPasse('passe.json com pastaNotas inválida.');
  }
  if (typeof p.token !== 'string' || p.token.length < 10) {
    throw new ErroPasse('passe.json sem token do GitHub.');
  }
  if (typeof p.materiaisFolderId !== 'string' || !ID_DRIVE_VALIDO.test(p.materiaisFolderId)) {
    throw new ErroPasse('passe.json com materiaisFolderId inválido.');
  }
  return {
    versao: 1,
    usuario: p.usuario,
    nome: p.nome,
    repo: p.repo,
    branch: p.branch,
    pastaNotas: p.pastaNotas,
    token: p.token,
    materiaisFolderId: p.materiaisFolderId,
  };
}
