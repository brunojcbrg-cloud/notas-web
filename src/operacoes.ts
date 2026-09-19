import {
  BRANCH, CaminhoExistente, ConflitoGitHub, ErroGitHub, PASTA, REPO,
  validarCaminho, type Fetcher,
} from './github';

const API = `https://api.github.com/repos/${REPO}`;

export interface OrigemMovimento {
  tipo: 'nota' | 'pasta';
  caminho: string; // Nota: caminho completo. Pasta: caminho relativo a 06_Conhecimento.
}

export interface ResultadoMovimento {
  caminhos: Map<string, string>;
  treeSha: string;
}

function validarPasta(pasta: string): void {
  if (pasta === '') return;
  validarCaminho(`${PASTA}${pasta}/__validacao__.md`);
  if (pasta.startsWith('/') || pasta.endsWith('/')) throw new Error('Pasta inválida.');
}

export function planejarMovimento(
  origem: OrigemMovimento,
  destino: string,
  blobs: ReadonlyMap<string, string>,
): Map<string, string> {
  validarPasta(destino);
  const mudancas = new Map<string, string>();
  if (origem.tipo === 'nota') {
    validarCaminho(origem.caminho);
    const nome = origem.caminho.split('/').at(-1) as string;
    if (!blobs.has(origem.caminho)) throw new Error('SHA da nota indisponível. Recarregue a lista.');
    mudancas.set(origem.caminho, `${PASTA}${destino ? `${destino}/` : ''}${nome}`);
  } else {
    validarPasta(origem.caminho);
    if (!origem.caminho) throw new Error('A pasta principal não pode ser movida.');
    if (destino === origem.caminho || destino.startsWith(`${origem.caminho}/`)) {
      throw new Error('Uma pasta não pode ser movida para dentro de si mesma.');
    }
    const nome = origem.caminho.split('/').at(-1) as string;
    const prefixo = `${PASTA}${origem.caminho}/`;
    const novoPrefixo = `${PASTA}${destino ? `${destino}/` : ''}${nome}/`;
    if ([...blobs.keys()].some((caminho) => caminho.startsWith(novoPrefixo))) throw new CaminhoExistente();
    for (const caminho of blobs.keys()) {
      if (caminho.startsWith(prefixo)) mudancas.set(caminho, `${novoPrefixo}${caminho.slice(prefixo.length)}`);
    }
    if (!mudancas.size) throw new Error('Pasta sem notas ou SHAs indisponíveis. Recarregue a lista.');
  }
  for (const [antigo, novo] of mudancas) {
    validarCaminho(antigo);
    validarCaminho(novo);
    if (novo === antigo) throw new Error('A nota já está nessa pasta.');
    if (blobs.has(novo) && !mudancas.has(novo)) throw new CaminhoExistente();
    if ([...blobs.keys()].some((caminho) => caminho.startsWith(`${novo}/`))) throw new CaminhoExistente();
  }
  return mudancas;
}

function cabecalhos(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

async function requisitar(
  fetcher: Fetcher, token: string, url: string, method = 'GET', body?: unknown,
): Promise<Record<string, unknown>> {
  const resposta = await fetcher(url, {
    method,
    headers: cabecalhos(token),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!resposta.ok) {
    if (resposta.status === 409 || resposta.status === 422) throw new ConflitoGitHub();
    if (resposta.status === 401 || resposta.status === 403) {
      throw new ErroGitHub(resposta.status, 'Token inválido, expirado ou sem permissão Contents: Read and write.');
    }
    throw new ErroGitHub(resposta.status, `Falha na API do GitHub (${resposta.status}).`);
  }
  return await resposta.json() as Record<string, unknown>;
}

function shaDe(objeto: Record<string, unknown>, campo = 'sha'): string {
  const valor = objeto[campo];
  if (typeof valor !== 'string' || !valor) throw new ErroGitHub(502, 'Resposta inesperada da API do GitHub.');
  return valor;
}

export async function mover(
  token: string,
  origem: OrigemMovimento,
  destino: string,
  blobs: ReadonlyMap<string, string>,
  treeShaConhecido: string,
  fetcher: Fetcher = fetch,
): Promise<ResultadoMovimento> {
  const mudancas = planejarMovimento(origem, destino, blobs);
  if (!treeShaConhecido) throw new Error('SHA da árvore indisponível. Recarregue a lista.');
  const ref = await requisitar(fetcher, token, `${API}/git/ref/heads/${BRANCH}`);
  const commitAtual = shaDe(ref.object as Record<string, unknown>);
  const commit = await requisitar(fetcher, token, `${API}/git/commits/${commitAtual}`);
  const arvoreAtual = shaDe(commit.tree as Record<string, unknown>);
  if (arvoreAtual !== treeShaConhecido) throw new ConflitoGitHub();

  const entradas: Array<{ path: string; mode: '100644'; type: 'blob'; sha: string | null }> = [];
  for (const [antigo, novo] of mudancas) {
    entradas.push({ path: antigo, mode: '100644', type: 'blob', sha: null });
    entradas.push({ path: novo, mode: '100644', type: 'blob', sha: blobs.get(antigo) as string });
  }
  const arvore = await requisitar(fetcher, token, `${API}/git/trees`, 'POST', {
    base_tree: arvoreAtual, tree: entradas,
  });
  const novaArvore = shaDe(arvore);
  const nomeDestino = origem.tipo === 'nota'
    ? mudancas.get(origem.caminho) as string
    : `${PASTA}${destino ? `${destino}/` : ''}${origem.caminho.split('/').at(-1)}/`;
  const novoCommit = await requisitar(fetcher, token, `${API}/git/commits`, 'POST', {
    message: `notas-web: mover ${origem.caminho} → ${nomeDestino}`,
    tree: novaArvore,
    parents: [commitAtual],
  });
  await requisitar(fetcher, token, `${API}/git/refs/heads/${BRANCH}`, 'PATCH', {
    sha: shaDe(novoCommit),
  });
  return { caminhos: mudancas, treeSha: novaArvore };
}
