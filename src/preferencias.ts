import { codificarBase64, decodificarBase64 } from './bytes';
import { branchAtual, repoAtual } from './github';
import { PREFERENCIA_PADRAO, type ModoCor, type PreferenciaTema, type TemaMarkdown } from './themes';

/**
 * Fora de `06_Conhecimento/`, pelo mesmo motivo do manifesto de materiais: o que
 * mora lá vira nota no Obsidian e no celular, e isto é configuração, não nota.
 */
export const CAMINHO_PREFERENCIAS = '05_Sistema/notas-web/preferencias.json';

export type Fetcher = typeof fetch;

export interface PreferenciasRemotas {
  preferencia: PreferenciaTema;
  sha: string;
}

const TEMAS = ['padrao', 'obsidian', 'solarized'];
const MODOS = ['system', 'light', 'dark'];

/**
 * Lê o que veio do repositório sem confiar nele: um arquivo editado à mão, ou
 * escrito por uma versão futura, não pode derrubar a tela nem trocar o tema por
 * um valor que a paleta não conhece.
 */
export function analisarPreferencias(texto: string): PreferenciaTema | null {
  try {
    const cru = JSON.parse(texto) as Partial<PreferenciaTema>;
    if (!cru || typeof cru !== 'object') return null;
    const tema = TEMAS.includes(String(cru.tema)) ? (cru.tema as TemaMarkdown) : null;
    const modo = MODOS.includes(String(cru.modo)) ? (cru.modo as ModoCor) : null;
    if (tema === null && modo === null) return null;
    return { tema: tema ?? PREFERENCIA_PADRAO.tema, modo: modo ?? PREFERENCIA_PADRAO.modo };
  } catch {
    return null;
  }
}

export function serializarPreferencias(preferencia: PreferenciaTema): string {
  return `${JSON.stringify({ tema: preferencia.tema, modo: preferencia.modo }, null, 2)}\n`;
}

function url(): string {
  return `https://api.github.com/repos/${repoAtual()}/contents/${encodeURI(CAMINHO_PREFERENCIAS)}`;
}

function cabecalhos(token: string): Record<string, string> {
  return { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` };
}

/** Nulo quando o arquivo ainda não existe -- que é o estado de toda máquina nova. */
export async function lerPreferenciasRemotas(
  token: string,
  fetcher: Fetcher = fetch,
): Promise<PreferenciasRemotas | null> {
  const resposta = await fetcher(`${url()}?ref=${branchAtual()}`, { headers: cabecalhos(token) });
  if (resposta.status === 404) return null;
  if (!resposta.ok) {
    throw new Error(`Não foi possível ler a preferência de tema (${resposta.status}).`);
  }
  const corpo = (await resposta.json()) as { content?: unknown; sha?: unknown };
  if (typeof corpo.content !== 'string' || typeof corpo.sha !== 'string') return null;
  const preferencia = analisarPreferencias(decodificarBase64(corpo.content).texto);
  return preferencia ? { preferencia, sha: corpo.sha } : null;
}

/**
 * Grava a preferência. O `sha` é relido na hora: a outra máquina pode ter
 * mudado o tema no meio, e aqui o certo é a última troca vencer -- não travar
 * a tela com um conflito que o dono não pediu para resolver.
 */
export async function guardarPreferenciasRemotas(
  token: string,
  preferencia: PreferenciaTema,
  fetcher: Fetcher = fetch,
): Promise<void> {
  const atual = await lerPreferenciasRemotas(token, fetcher).catch(() => null);
  const corpo: Record<string, string> = {
    message: `notas-web: ${CAMINHO_PREFERENCIAS}`,
    content: codificarBase64(serializarPreferencias(preferencia), false),
    branch: branchAtual(),
  };
  if (atual) corpo.sha = atual.sha;
  const resposta = await fetcher(url(), {
    method: 'PUT',
    headers: { ...cabecalhos(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  if (!resposta.ok) {
    throw new Error(`Não foi possível gravar a preferência de tema (${resposta.status}).`);
  }
}
