import { bytesParaBase64 } from './bytes';
import { branchAtual, repoAtual } from './github';

/** Pasta única de anexos das notas, a mesma que o Obsidian e o app usam. */
export const PASTA_ANEXOS = '06_Conhecimento/_anexos/';

const TIPOS: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
};

export type Fetcher = typeof fetch;

export function tipoDaImagem(nome: string): string | null {
  const ponto = nome.lastIndexOf('.');
  if (ponto < 0) return null;
  return TIPOS[nome.slice(ponto + 1).toLocaleLowerCase('en')] ?? null;
}

export function ehImagem(nome: string): boolean {
  return tipoDaImagem(nome) !== null;
}

/** Só o nome do arquivo, aceitando barra normal ou invertida. */
export function nomeDoArquivo(alvo: string): string {
  const limpo = alvo.replace(/\\/g, '/');
  return limpo.slice(limpo.lastIndexOf('/') + 1);
}

/**
 * O Obsidian resolve `![[nome.png]]` procurando o nome no vault inteiro; a web
 * resolve dentro da pasta de anexos, que é onde toda colagem nova cai. Caminho
 * completo continua valendo, para quem escreveu `![](06_Conhecimento/...)`.
 */
export function resolverAnexo(
  caminhos: readonly string[],
  alvo: string,
): string | null {
  const limpo = alvo.replace(/\\/g, '/').replace(/^\.\//, '');
  if (caminhos.includes(limpo)) return limpo;
  const nome = nomeDoArquivo(limpo).toLocaleLowerCase('pt-BR');
  const dentroDaPasta = caminhos.find(
    (caminho) =>
      caminho.startsWith(PASTA_ANEXOS) &&
      nomeDoArquivo(caminho).toLocaleLowerCase('pt-BR') === nome,
  );
  if (dentroDaPasta) return dentroDaPasta;
  return (
    caminhos.find(
      (caminho) => nomeDoArquivo(caminho).toLocaleLowerCase('pt-BR') === nome,
    ) ?? null
  );
}

/**
 * Nome no padrão do Obsidian, para os três clientes gravarem indistinguível:
 * `Pasted image 20260921143005.png`.
 */
const cache = new Map<string, string>();

const BARRA_INVERTIDA = '\\';

export function nomeDeColagem(agora: Date = new Date(), extensao = 'png'): string {
  const d = (valor: number, casas = 2) => String(valor).padStart(casas, '0');
  const carimbo =
    `${d(agora.getFullYear(), 4)}${d(agora.getMonth() + 1)}${d(agora.getDate())}` +
    `${d(agora.getHours())}${d(agora.getMinutes())}${d(agora.getSeconds())}`;
  return `Pasted image ${carimbo}.${extensao}`;
}

/** Recusa nome que escape da pasta de anexos ou que não seja imagem. */
export function validarNomeDeAnexo(nome: string): void {
  if (
    !nome ||
    nome.includes('/') ||
    nome.includes(BARRA_INVERTIDA) ||
    nome.includes('..') ||
    nome.startsWith('.') ||
    !ehImagem(nome)
  ) {
    throw new Error(`Nome de anexo inválido: ${nome}`);
  }
}

/**
 * Reduz o maior lado para [ladoMaximo] e grava PNG -- o mesmo formato que o
 * Obsidian produz ao colar, para a nota abrir igual nos três lugares.
 *
 * Sem o teto, cada print de tela engorda o clone do celular para sempre.
 */
export async function comprimirImagem(arquivo: Blob, ladoMaximo = 1600): Promise<Blob> {
  const bitmap = await createImageBitmap(arquivo);
  const maior = Math.max(bitmap.width, bitmap.height);
  const escala = maior > ladoMaximo ? ladoMaximo / maior : 1;
  const largura = Math.max(1, Math.round(bitmap.width * escala));
  const altura = Math.max(1, Math.round(bitmap.height * escala));
  const tela = document.createElement('canvas');
  tela.width = largura;
  tela.height = altura;
  const contexto = tela.getContext('2d');
  if (!contexto) throw new Error('O navegador não deixou desenhar a imagem.');
  contexto.drawImage(bitmap, 0, 0, largura, altura);
  bitmap.close?.();
  const png = await new Promise<Blob | null>((resolver) => tela.toBlob(resolver, 'image/png'));
  if (!png) throw new Error('Não foi possível converter a imagem.');
  return png;
}

/**
 * Grava o anexo no repositório e devolve o caminho.
 *
 * Caminho próprio, e não o `putNota` do github.ts: aquele exige `.md` de
 * propósito, e afrouxar a regra dele para caber imagem abriria a porta para
 * gravar qualquer coisa em qualquer lugar.
 */
export async function enviarAnexo(
  token: string,
  nome: string,
  bytes: Uint8Array,
  fetcher: Fetcher = fetch,
): Promise<string> {
  validarNomeDeAnexo(nome);
  const caminho = `${PASTA_ANEXOS}${nome}`;
  const conteudo = bytesParaBase64(bytes);
  const url = `https://api.github.com/repos/${repoAtual()}/contents/${encodeURI(caminho)}`;
  const resposta = await fetcher(url, {
    method: 'PUT',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: `notas-web: ${caminho}`,
      content: conteudo,
      branch: branchAtual(),
    }),
  });
  if (resposta.status === 422 || resposta.status === 409) {
    throw new Error(`Já existe um anexo chamado ${nome}.`);
  }
  if (!resposta.ok) {
    throw new Error(`Não foi possível enviar ${nome} (${resposta.status}).`);
  }
  cache.set(caminho, `data:${tipoDaImagem(nome) ?? 'image/png'};base64,${conteudo}`);
  return caminho;
}

interface ItemConteudo {
  path?: unknown;
  type?: unknown;
}

/** Lista os anexos publicados. Uma chamada só, e o resultado é reaproveitado. */
export async function listarAnexos(
  token: string,
  fetcher: Fetcher = fetch,
): Promise<string[]> {
  const url = `https://api.github.com/repos/${repoAtual()}/contents/${encodeURI(
    PASTA_ANEXOS.replace(/\/$/, ''),
  )}?ref=${branchAtual()}`;
  const resposta = await fetcher(url, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` },
  });
  if (resposta.status === 404) return [];
  if (!resposta.ok) throw new Error(`Não foi possível listar os anexos (${resposta.status}).`);
  const itens = (await resposta.json()) as ItemConteudo[];
  if (!Array.isArray(itens)) return [];
  return itens
    .filter((item) => item.type === 'file' && typeof item.path === 'string')
    .map((item) => item.path as string)
    .filter(ehImagem);
}

/** Devolve o anexo como data URL: o repositório é privado, não há URL crua. */
export async function carregarAnexo(
  token: string,
  caminho: string,
  fetcher: Fetcher = fetch,
): Promise<string> {
  const guardado = cache.get(caminho);
  if (guardado) return guardado;
  const tipo = tipoDaImagem(caminho);
  if (!tipo) throw new Error(`Extensão de imagem não suportada: ${caminho}`);
  const url = `https://api.github.com/repos/${repoAtual()}/contents/${encodeURI(caminho)}?ref=${branchAtual()}`;
  const resposta = await fetcher(url, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` },
  });
  if (!resposta.ok) throw new Error(`Não foi possível ler ${caminho} (${resposta.status}).`);
  const corpo = (await resposta.json()) as { content?: unknown; encoding?: unknown };
  if (typeof corpo.content !== 'string' || corpo.encoding !== 'base64') {
    throw new Error(`Resposta sem conteúdo base64 para ${caminho}.`);
  }
  const dataUrl = `data:${tipo};base64,${corpo.content.replace(/\s/g, '')}`;
  cache.set(caminho, dataUrl);
  return dataUrl;
}

export function limparCacheDeAnexos(): void {
  cache.clear();
}

/**
 * Preenche o `src` depois da sanitização: o HTML sanitizado sai sem `src`, então
 * nenhuma data URL passa pelo DOMPurify.
 */
export async function hidratarImagens(
  container: ParentNode,
  token: string,
  anexos: readonly string[],
  fetcher: Fetcher = fetch,
): Promise<void> {
  const alvos = [...container.querySelectorAll<HTMLImageElement>('img[data-anexo]')];
  await Promise.all(
    alvos.map(async (img) => {
      const alvo = img.dataset.anexo ?? '';
      const caminho = resolverAnexo(anexos, alvo);
      if (!caminho) {
        img.classList.add('nota-imagem-faltante');
        img.alt = img.alt || alvo;
        return;
      }
      try {
        img.src = await carregarAnexo(token, caminho, fetcher);
        img.classList.remove('nota-imagem-faltante');
      } catch {
        img.classList.add('nota-imagem-faltante');
        img.alt = img.alt || alvo;
      }
    }),
  );
}
