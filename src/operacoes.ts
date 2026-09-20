import {
  BRANCH, CaminhoExistente, ConflitoGitHub, ErroGitHub, PASTA, REPO,
  validarCaminho, type Fetcher,
} from './github';
import { analisarAlvo } from './markdown';
import { codificarBase64, decodificarBase64 } from './bytes';
import { nomeDaNota } from './tree';

const API = `https://api.github.com/repos/${REPO}`;

export interface OrigemMovimento {
  tipo: 'nota' | 'pasta';
  caminho: string; // Nota: caminho completo. Pasta: caminho relativo a 06_Conhecimento.
}

export interface ResultadoMovimento {
  caminhos: Map<string, string>;
  treeSha: string;
}

export function validarPasta(pasta: string): void {
  if (pasta === '') return;
  validarCaminho(`${PASTA}${pasta}/__validacao__.md`);
  if (pasta.startsWith('/') || pasta.endsWith('/')) throw new Error('Pasta inválida.');
}

export function planejarRenomeacao(
  origem: OrigemMovimento, nome: string, blobs: ReadonlyMap<string, string>,
): Map<string, string> {
  const mudancas = new Map<string, string>();
  if (!nome || nome === '.' || nome.includes('/') || nome.includes('\\') || nome.includes('..')) {
    throw new Error('Nome inválido.');
  }
  if (origem.tipo === 'nota') {
    validarCaminho(origem.caminho);
    if (!blobs.has(origem.caminho)) throw new Error('SHA da nota indisponível. Recarregue a lista.');
    const arquivo = nome.endsWith('.md') ? nome : `${nome}.md`;
    const partes = origem.caminho.split('/');
    partes[partes.length - 1] = arquivo;
    mudancas.set(origem.caminho, partes.join('/'));
  } else {
    validarPasta(origem.caminho);
    if (!origem.caminho) throw new Error('A pasta principal não pode ser renomeada.');
    const prefixo = `${PASTA}${origem.caminho}/`;
    const partes = origem.caminho.split('/');
    partes[partes.length - 1] = nome;
    const novoPrefixo = `${PASTA}${partes.join('/')}/`;
    validarPasta(partes.join('/'));
    for (const caminho of blobs.keys()) {
      if (caminho.startsWith(prefixo)) mudancas.set(caminho, `${novoPrefixo}${caminho.slice(prefixo.length)}`);
    }
    if (!mudancas.size) throw new Error('Pasta sem notas ou SHAs indisponíveis. Recarregue a lista.');
  }
  for (const [antigo, novo] of mudancas) {
    validarCaminho(antigo);
    validarCaminho(novo);
    if (novo === antigo) throw new Error('O nome não mudou.');
    if (blobs.has(novo) && !mudancas.has(novo)) throw new CaminhoExistente();
  }
  return mudancas;
}

export interface ReescritaLink {
  caminho: string;
  blobSha: string;
  texto: string;
  tinhaBom: boolean;
  quantidade: number;
}

export interface PlanoRenomeacao {
  caminhos: Map<string, string>;
  reescritas: ReescritaLink[];
  reescritos: number;
  ignorados: number;
}

// A resolução atual usa só o nome. Havendo homônimos, não escolhemos um deles.
export async function analisarRenomeacao(
  token: string, origem: OrigemMovimento, nome: string,
  blobs: ReadonlyMap<string, string>, fetcher: Fetcher = fetch,
): Promise<PlanoRenomeacao> {
  const caminhos = planejarRenomeacao(origem, nome, blobs);
  const plano: PlanoRenomeacao = { caminhos, reescritas: [], reescritos: 0, ignorados: 0 };
  if (origem.tipo !== 'nota') return plano;
  const nomeAntigo = nomeDaNota(origem.caminho).toLocaleLowerCase('pt-BR');
  const nomeNovo = nomeDaNota(caminhos.get(origem.caminho) as string);
  const ambiguo = [...blobs.keys()].filter((caminho) => nomeDaNota(caminho).toLocaleLowerCase('pt-BR') === nomeAntigo).length !== 1
    || [...blobs.keys()].some((caminho) => caminho !== origem.caminho && nomeDaNota(caminho).toLocaleLowerCase('pt-BR') === nomeNovo.toLocaleLowerCase('pt-BR'));
  // Limitar concorrência evita rajadas de 139 pedidos no vault maior.
  const entradas = [...blobs.entries()];
  for (let i = 0; i < entradas.length; i += 8) {
    await Promise.all(entradas.slice(i, i + 8).map(async ([caminho, blobSha]) => {
      validarCaminho(caminho);
      const dados = await requisitar(fetcher, token, `${API}/git/blobs/${blobSha}`);
      if (typeof dados.content !== 'string') throw new ErroGitHub(502, 'Blob sem conteúdo.');
      const nota = decodificarBase64(dados.content);
      let quantidade = 0;
      let cerca: { caractere: string; minimo: number } | null = null;
      const reescreverLinha = (linha: string): string => linha.replace(/(!?\[\[)([^\]\r\n]+)(\]\])/g, (inteiro, abertura: string, bruto: string, fechamento: string, posicao: number) => {
        // Wikilinks literais em código não navegam e não devem ser alterados.
        const antes = linha.slice(0, posicao);
        let delimitador = 0;
        for (const trecho of antes.matchAll(/`+/g)) {
          if (!delimitador) delimitador = trecho[0].length;
          else if (delimitador === trecho[0].length) delimitador = 0;
        }
        if (delimitador) return inteiro;
        const alvo = analisarAlvo(bruto, abertura.startsWith('!'));
        if (alvo.alvo.split('/').at(-1)?.replace(/\.md$/i, '').toLocaleLowerCase('pt-BR') !== nomeAntigo) return inteiro;
        if (ambiguo || nota.somenteLeitura) { plano.ignorados += 1; return inteiro; }
        quantidade += 1;
        const divisor = bruto.indexOf('|');
        const comAlias = divisor < 0 ? bruto : bruto.slice(0, divisor);
        const resto = divisor < 0 ? '' : bruto.slice(divisor);
        const secao = comAlias.indexOf('#');
        const semSecao = secao < 0 ? comAlias : comAlias.slice(0, secao);
        const sufixo = secao < 0 ? '' : comAlias.slice(secao);
        const barra = semSecao.lastIndexOf('/');
        const prefixo = barra < 0 ? '' : semSecao.slice(0, barra + 1);
        const espacoInicial = semSecao.slice(barra + 1).match(/^\s*/)?.[0] ?? '';
        const espaco = semSecao.match(/\s*$/)?.[0] ?? '';
        const extensao = /\.md\s*$/i.test(semSecao) ? '.md' : '';
        return `${abertura}${prefixo}${espacoInicial}${nomeNovo}${extensao}${espaco}${sufixo}${resto}${fechamento}`;
      });
      const texto = nota.texto.split(/(?<=\n)/).map((linha) => {
        const marcador = /^ {0,3}(`{3,}|~{3,})/.exec(linha)?.[1];
        if (marcador) {
          if (!cerca) cerca = { caractere: marcador[0], minimo: marcador.length };
          else if (marcador[0] === cerca.caractere && marcador.length >= cerca.minimo && linha.trim() === marcador) cerca = null;
          return linha;
        }
        return cerca ? linha : reescreverLinha(linha);
      }).join('');
      if (quantidade) {
        plano.reescritos += quantidade;
        plano.reescritas.push({ caminho, blobSha, texto, tinhaBom: nota.tinhaBom, quantidade });
      }
    }));
  }
  return plano;
}

export interface ResultadoRenomeacao extends ResultadoMovimento {
  blobsReescritos: Map<string, string>;
}

export function planejarExclusao(origem: OrigemMovimento, blobs: ReadonlyMap<string, string>): string[] {
  if (origem.tipo === 'nota') {
    validarCaminho(origem.caminho);
    if (!blobs.has(origem.caminho)) throw new Error('SHA da nota indisponível. Recarregue a lista.');
    return [origem.caminho];
  }
  validarPasta(origem.caminho);
  if (!origem.caminho) throw new Error('A pasta principal não pode ser apagada.');
  const prefixo = `${PASTA}${origem.caminho}/`;
  const caminhos = [...blobs.keys()].filter((caminho) => caminho.startsWith(prefixo));
  if (!caminhos.length) throw new Error('Pasta sem notas ou SHAs indisponíveis. Recarregue a lista.');
  caminhos.forEach(validarCaminho);
  return caminhos;
}

export interface ResultadoExclusao {
  removidos: string[];
  treeSha: string;
}

export async function apagar(
  token: string, origem: OrigemMovimento, blobs: ReadonlyMap<string, string>,
  treeShaConhecido: string, fetcher: Fetcher = fetch,
): Promise<ResultadoExclusao> {
  const removidos = planejarExclusao(origem, blobs);
  if (!treeShaConhecido) throw new Error('SHA da árvore indisponível. Recarregue a lista.');
  const ref = await requisitar(fetcher, token, `${API}/git/ref/heads/${BRANCH}`);
  const commitAtual = shaDe(ref.object as Record<string, unknown>);
  const commit = await requisitar(fetcher, token, `${API}/git/commits/${commitAtual}`);
  const arvoreAtual = shaDe(commit.tree as Record<string, unknown>);
  if (arvoreAtual !== treeShaConhecido) throw new ConflitoGitHub();
  const entradas = removidos.map((path) => ({ path, mode: '100644', type: 'blob', sha: null }));
  const arvore = await requisitar(fetcher, token, `${API}/git/trees`, 'POST', {
    base_tree: arvoreAtual, tree: entradas,
  });
  const novaArvore = shaDe(arvore);
  const novoCommit = await requisitar(fetcher, token, `${API}/git/commits`, 'POST', {
    message: `notas-web: apagar ${origem.caminho} (${removidos.length} nota${removidos.length === 1 ? '' : 's'})`,
    tree: novaArvore, parents: [commitAtual],
  });
  await requisitar(fetcher, token, `${API}/git/refs/heads/${BRANCH}`, 'PATCH', { sha: shaDe(novoCommit) });
  return { removidos, treeSha: novaArvore };
}

export async function renomear(
  token: string, origem: OrigemMovimento, plano: PlanoRenomeacao,
  blobs: ReadonlyMap<string, string>, treeShaConhecido: string,
  fetcher: Fetcher = fetch,
): Promise<ResultadoRenomeacao> {
  for (const [antigo, novo] of plano.caminhos) {
    validarCaminho(antigo); validarCaminho(novo);
    if (blobs.has(novo) && !plano.caminhos.has(novo)) throw new CaminhoExistente();
  }
  if (!treeShaConhecido) throw new Error('SHA da árvore indisponível. Recarregue a lista.');
  const ref = await requisitar(fetcher, token, `${API}/git/ref/heads/${BRANCH}`);
  const commitAtual = shaDe(ref.object as Record<string, unknown>);
  const commit = await requisitar(fetcher, token, `${API}/git/commits/${commitAtual}`);
  const arvoreAtual = shaDe(commit.tree as Record<string, unknown>);
  if (arvoreAtual !== treeShaConhecido) throw new ConflitoGitHub();
  const novosShas = new Map<string, string>();
  for (const item of plano.reescritas) {
    validarCaminho(item.caminho);
    if (blobs.get(item.caminho) !== item.blobSha) throw new ConflitoGitHub();
    const criado = await requisitar(fetcher, token, `${API}/git/blobs`, 'POST', {
      content: codificarBase64(item.texto, item.tinhaBom), encoding: 'base64',
    });
    novosShas.set(item.caminho, shaDe(criado));
  }
  const entradas: Array<{ path: string; mode: '100644'; type: 'blob'; sha: string | null }> = [];
  for (const [antigo, novo] of plano.caminhos) {
    entradas.push({ path: antigo, mode: '100644', type: 'blob', sha: null });
    entradas.push({ path: novo, mode: '100644', type: 'blob', sha: novosShas.get(antigo) ?? blobs.get(antigo) as string });
  }
  for (const [caminho, sha] of novosShas) {
    if (!plano.caminhos.has(caminho)) entradas.push({ path: caminho, mode: '100644', type: 'blob', sha });
  }
  const arvore = await requisitar(fetcher, token, `${API}/git/trees`, 'POST', { base_tree: arvoreAtual, tree: entradas });
  const novaArvore = shaDe(arvore);
  const nomeNovo = origem.tipo === 'nota' ? plano.caminhos.get(origem.caminho) : [...plano.caminhos.values()][0];
  const novoCommit = await requisitar(fetcher, token, `${API}/git/commits`, 'POST', {
    message: `notas-web: renomear ${origem.caminho} → ${nomeNovo}`,
    tree: novaArvore, parents: [commitAtual],
  });
  await requisitar(fetcher, token, `${API}/git/refs/heads/${BRANCH}`, 'PATCH', { sha: shaDe(novoCommit) });
  return { caminhos: plano.caminhos, treeSha: novaArvore, blobsReescritos: novosShas };
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
