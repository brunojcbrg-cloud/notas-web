import { decodificarBase64, type NotaDecodificada } from './bytes';

export const REPO = 'brunojcbrg-cloud/vault-conhecimento';
export const BRANCH = 'master';
export const PASTA = '06_Conhecimento/';
const API = 'https://api.github.com';

export interface NotaRemota extends NotaDecodificada {
  caminho: string;
  sha: string;
}

export interface ResultadoGravacao {
  sha: string;
  treeSha?: string;
}

export interface ListaNotas {
  caminhos: string[];
  blobs: Map<string, string>;
  treeSha: string;
}

export type Fetcher = typeof fetch;

export class ErroGitHub extends Error {
  constructor(
    public readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroGitHub';
  }
}

export class ConflitoGitHub extends ErroGitHub {
  constructor() {
    super(409, 'Esta nota mudou no repositório desde que você a abriu.');
    this.name = 'ConflitoGitHub';
  }
}

export class CaminhoExistente extends Error {
  constructor() {
    super('Já existe uma nota com esse caminho.');
    this.name = 'CaminhoExistente';
  }
}

export function validarCaminho(caminho: string): void {
  if (
    !caminho.startsWith(PASTA) ||
    !caminho.endsWith('.md') ||
    caminho.includes('..') ||
    caminho.includes('\\') ||
    caminho.slice(PASTA.length).split('/').some((parte) => !parte)
  ) {
    throw new Error('Caminho fora de 06_Conhecimento ou inválido.');
  }
}

export function codificarCaminho(caminho: string): string {
  validarCaminho(caminho);
  return caminho.split('/').map(encodeURIComponent).join('/');
}

function cabecalhos(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function verificarResposta(resposta: Response): Promise<void> {
  if (resposta.ok) return;
  if (resposta.status === 409) throw new ConflitoGitHub();
  if (resposta.status === 401 || resposta.status === 403) {
    throw new ErroGitHub(
      resposta.status,
      'Token inválido, expirado ou sem permissão Contents: Read and write.',
    );
  }
  if (resposta.status === 404) {
    throw new ErroGitHub(404, 'Nota ou repositório não encontrado.');
  }
  throw new ErroGitHub(resposta.status, `Falha na API do GitHub (${resposta.status}).`);
}

export async function listarNotasComSha(token: string, fetcher: Fetcher = fetch): Promise<ListaNotas> {
  const url = `${API}/repos/${REPO}/git/trees/${BRANCH}?recursive=1`;
  const resposta = await fetcher(url, { headers: cabecalhos(token) });
  await verificarResposta(resposta);
  const dados = (await resposta.json()) as {
    sha?: string;
    truncated?: boolean;
    tree?: Array<{ path?: string; type?: string; sha?: string }>;
  };
  if (dados.truncated || typeof dados.sha !== 'string') {
    throw new ErroGitHub(502, 'Árvore incompleta ou sem SHA; mover notas não é seguro.');
  }
  const itens = (dados.tree ?? [])
    .filter(
      (item): item is { path: string; type?: string; sha?: string } =>
        typeof item.path === 'string' &&
        item.type === 'blob' &&
        item.path.startsWith(PASTA) &&
        item.path.endsWith('.md'),
    );
  if (itens.some((item) => typeof item.sha !== 'string' || !item.sha)) {
    throw new ErroGitHub(502, 'Árvore sem SHA de blob; mover notas não é seguro.');
  }
  return {
    caminhos: itens.map((item) => item.path).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    blobs: new Map(itens.filter((item) => typeof item.sha === 'string').map((item) => [item.path, item.sha as string])),
    treeSha: dados.sha,
  };
}

export async function listarNotas(token: string, fetcher: Fetcher = fetch): Promise<string[]> {
  const url = `${API}/repos/${REPO}/git/trees/${BRANCH}?recursive=1`;
  const resposta = await fetcher(url, { headers: cabecalhos(token) });
  await verificarResposta(resposta);
  const dados = (await resposta.json()) as { tree?: Array<{ path?: string; type?: string }> };
  return (dados.tree ?? [])
    .filter((item): item is { path: string; type?: string } =>
      typeof item.path === 'string' && item.type === 'blob' &&
      item.path.startsWith(PASTA) && item.path.endsWith('.md'))
    .map((item) => item.path).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

export async function lerNota(
  token: string,
  caminho: string,
  fetcher: Fetcher = fetch,
): Promise<NotaRemota> {
  const url = `${API}/repos/${REPO}/contents/${codificarCaminho(caminho)}?ref=${BRANCH}`;
  const resposta = await fetcher(url, { headers: cabecalhos(token) });
  await verificarResposta(resposta);
  const dados = (await resposta.json()) as { content?: string; sha?: string };
  if (typeof dados.content !== 'string' || typeof dados.sha !== 'string') {
    throw new ErroGitHub(502, 'Resposta inesperada da API do GitHub.');
  }
  return { caminho, sha: dados.sha, ...decodificarBase64(dados.content) };
}

async function putNota(
  token: string,
  caminho: string,
  content: string,
  sha: string | undefined,
  fetcher: Fetcher,
): Promise<ResultadoGravacao> {
  validarCaminho(caminho);
  const corpo: { message: string; content: string; branch: string; sha?: string } = {
    message: `notas-web: ${caminho}`,
    content,
    branch: BRANCH,
  };
  if (sha !== undefined) corpo.sha = sha;
  const resposta = await fetcher(
    `${API}/repos/${REPO}/contents/${codificarCaminho(caminho)}`,
    {
      method: 'PUT',
      headers: { ...cabecalhos(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    },
  );
  await verificarResposta(resposta);
  const dados = (await resposta.json()) as { content?: { sha?: string }; commit?: { tree?: { sha?: string } } };
  if (typeof dados.content?.sha !== 'string') {
    throw new ErroGitHub(502, 'Resposta inesperada ao gravar a nota.');
  }
  return { sha: dados.content.sha, treeSha: dados.commit?.tree?.sha };
}

export function salvarNota(
  token: string,
  caminho: string,
  content: string,
  sha: string,
  fetcher: Fetcher = fetch,
): Promise<ResultadoGravacao> {
  if (!sha) throw new Error('SHA obrigatório para salvar nota existente.');
  return putNota(token, caminho, content, sha, fetcher);
}

export function criarNota(
  token: string,
  caminho: string,
  content: string,
  caminhosExistentes: readonly string[],
  fetcher: Fetcher = fetch,
): Promise<ResultadoGravacao> {
  if (caminhosExistentes.includes(caminho)) throw new CaminhoExistente();
  return putNota(token, caminho, content, undefined, fetcher);
}

export const conflitoParaTela = {
  mensagem: 'Esta nota mudou no repositório desde que você a abriu.',
  acoes: ['recarregar', 'cancelar'] as const,
};
