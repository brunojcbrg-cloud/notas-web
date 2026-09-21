import DOMPurify from 'dompurify';
import { ehImagem, nomeDoArquivo } from './anexos';
import MarkdownIt from 'markdown-it';
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs';
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs';
import { nomeDaNota, pastaDaNota } from './tree';

export interface AlvoWikilink {
  bruto: string;
  alvo: string;
  secao: string;
  texto: string;
  embed: boolean;
}

export interface ContextoMarkdown {
  caminhos?: readonly string[];
  caminhoAtual?: string;
}

export interface CabecalhoMarkdown {
  titulo: string;
  nivel: number;
  /** Posição do primeiro `#` no documento. */
  posicao: number;
  /** Índice zero-based da linha, usado para recortar sem uma nova varredura. */
  linha: number;
}

export type AcaoWikilink =
  | { tipo: 'navegar'; caminho: string; secao: string }
  | { tipo: 'faltante' };

export function analisarAlvo(bruto: string, embed: boolean): AlvoWikilink {
  const [antesApelido, ...apelido] = bruto.split('|');
  const alvoComSecao = antesApelido.trim();
  const corte = alvoComSecao.indexOf('#');
  const alvo = corte < 0 ? alvoComSecao : alvoComSecao.slice(0, corte).trim();
  const secao = corte < 0 ? '' : alvoComSecao.slice(corte + 1).trim();
  const texto = apelido.join('|').trim() || alvoComSecao;
  return { bruto, alvo, secao, texto, embed };
}

/** `496` ou `800x600`, as duas formas que o Obsidian grava ao arrastar a alça. */
export function larguraDoRotulo(rotulo: string): number | null {
  const bruto = rotulo.trim();
  if (!bruto) return null;
  const casou = /^(\d{1,5})(?:x\d{1,5})?$/.exec(bruto);
  if (!casou) return null;
  const largura = Number(casou[1]);
  return Number.isFinite(largura) && largura > 0 ? largura : null;
}

/**
 * Onde começa a linha do título [secao], em caracteres. Nulo se não existir.
 *
 * O modo leitura rola pelo DOM (`rolarParaSecao`); o modo ao vivo é um editor de
 * texto e precisa da posição no documento.
 */
export function listarCabecalhos(texto: string): CabecalhoMarkdown[] {
  const cabecalhos: CabecalhoMarkdown[] = [];
  let posicao = 0;
  let numeroDaLinha = 0;
  while (posicao <= texto.length) {
    let fim = posicao;
    while (fim < texto.length && texto[fim] !== '\r' && texto[fim] !== '\n') fim += 1;
    const linha = texto.slice(posicao, fim);
    const achado = /^(#{1,6})\s+(.*)$/.exec(linha);
    if (achado) {
      cabecalhos.push({
        titulo: achado[2].trim(),
        nivel: achado[1].length,
        posicao,
        linha: numeroDaLinha,
      });
    }
    if (fim === texto.length) break;
    posicao = fim + (texto[fim] === '\r' && texto[fim + 1] === '\n' ? 2 : 1);
    numeroDaLinha += 1;
  }
  return cabecalhos;
}

export function posicaoDaSecao(texto: string, secao: string): number | null {
  const alvo = secao.replace(/^\^/, '').trim().toLocaleLowerCase('pt-BR');
  if (!alvo) return null;
  return (
    listarCabecalhos(texto).find(
      ({ titulo }) => titulo.toLocaleLowerCase('pt-BR') === alvo,
    )?.posicao ?? null
  );
}

export interface WikilinkNoTexto {
  /** Posição do primeiro `[`. */
  de: number;
  /** Posição logo depois do último `]`. */
  ate: number;
  /** Onde começa o texto que o leitor vê. */
  deTexto: number;
  /** Onde termina o texto que o leitor vê. */
  ateTexto: number;
  alvo: AlvoWikilink;
}

/**
 * Acha os wikilinks de um trecho, com as posições do que fica visível.
 *
 * Mesmas guardas de `regraWikilink`, que é quem monta o modo leitura: os dois
 * modos têm de concordar sobre o que é wikilink, senão a mesma nota aparece
 * diferente conforme o botão que está apertado. Embed de imagem (`![[…]]`) não
 * entra aqui — quem cuida dele é `anexos.ts`.
 */
export function acharWikilinks(texto: string, base = 0): WikilinkNoTexto[] {
  const achados: WikilinkNoTexto[] = [];
  let i = 0;
  while (i < texto.length - 1) {
    if (texto.charCodeAt(i) !== 0x5b || texto.charCodeAt(i + 1) !== 0x5b) {
      i += 1;
      continue;
    }
    if (i > 0 && texto.charCodeAt(i - 1) === 0x21) {
      i += 2;
      continue;
    }
    const fim = texto.indexOf(']]', i + 2);
    if (fim < 0) break;
    const bruto = texto.slice(i + 2, fim);
    if (!bruto.trim() || bruto.includes('\n') || bruto.includes('[')) {
      i += 2;
      continue;
    }
    const alvo = analisarAlvo(bruto, false);
    if (!alvo.alvo && !alvo.secao) {
      i += 2;
      continue;
    }
    // O visível é o apelido, quando existe, e o alvo com a seção quando não.
    const barra = bruto.indexOf('|');
    const inicioCru = barra < 0 ? 0 : barra + 1;
    const fimCru = barra < 0 ? bruto.length : bruto.length;
    const recorte = bruto.slice(inicioCru, fimCru);
    const espacosAntes = recorte.length - recorte.trimStart().length;
    const espacosDepois = recorte.length - recorte.trimEnd().length;
    achados.push({
      de: base + i,
      ate: base + fim + 2,
      deTexto: base + i + 2 + inicioCru + espacosAntes,
      ateTexto: base + i + 2 + fimCru - espacosDepois,
      alvo,
    });
    i = fim + 2;
  }
  return achados;
}

/** Um embed de imagem (`![[…]]`) achado no texto, com as pontas do recorte. */
export interface EmbedNoTexto {
  /** Posição do `!`. */
  de: number;
  /** Posição logo depois do último `]`. */
  ate: number;
  alvo: AlvoWikilink;
}

/**
 * Acha os embeds `![[…]]` de um trecho.
 *
 * Mesmas guardas de `regraWikilink`, pelo mesmo motivo de `acharWikilinks`: os
 * dois modos têm de concordar sobre o que é embed, senão a mesma nota aparece
 * diferente conforme o botão que está apertado. Quem decide se o alvo vira
 * imagem ou fica cru é o chamador, com `ehImagem`.
 */
export function acharEmbeds(texto: string, base = 0): EmbedNoTexto[] {
  const achados: EmbedNoTexto[] = [];
  let i = 0;
  while (i < texto.length - 2) {
    if (
      texto.charCodeAt(i) !== 0x21 ||
      texto.charCodeAt(i + 1) !== 0x5b ||
      texto.charCodeAt(i + 2) !== 0x5b
    ) {
      i += 1;
      continue;
    }
    const fim = texto.indexOf(']]', i + 3);
    if (fim < 0) break;
    const bruto = texto.slice(i + 3, fim);
    if (!bruto.trim() || bruto.includes('\n') || bruto.includes('[')) {
      i += 1;
      continue;
    }
    const alvo = analisarAlvo(bruto, true);
    if (!alvo.alvo) {
      i += 1;
      continue;
    }
    achados.push({ de: base + i, ate: base + fim + 2, alvo });
    i = fim + 2;
  }
  return achados;
}

/**
 * O rótulo do embed é largura (`|496`) ou texto alternativo, nunca os dois.
 *
 * Mora aqui porque o modo leitura monta `<img>` e o modo ao vivo monta um
 * widget do CodeMirror: se cada um decidisse sozinho, a mesma nota abriria com
 * tamanhos diferentes conforme o botão apertado.
 */
export function atributosDaImagem(
  alvo: string,
  rotulo: string,
): { alt: string; largura: number | null } {
  const largura = larguraDoRotulo(rotulo);
  return { alt: rotulo && largura === null ? rotulo : nomeDoArquivo(alvo), largura };
}

/** O rótulo que o embed carrega: vazio quando ele só repete o alvo. */
export function rotuloDoEmbed(alvo: AlvoWikilink): string {
  return alvo.texto === alvo.alvo ? '' : alvo.texto;
}

function escapar(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function resolverWikilink(
  caminhos: readonly string[],
  caminhoAtual: string,
  alvo: string,
): string | null {
  const nomeAlvo = alvo.split('/').at(-1)?.replace(/\.md$/i, '').toLocaleLowerCase('pt-BR');
  if (!nomeAlvo) return null;
  const candidatos = caminhos
    .filter((caminho) => nomeDaNota(caminho).toLocaleLowerCase('pt-BR') === nomeAlvo)
    .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
  if (candidatos.length === 0) return null;
  const pastaAtual = pastaDaNota(caminhoAtual);
  return candidatos.find((caminho) => pastaDaNota(caminho) === pastaAtual) ?? candidatos[0];
}

export function acaoWikilink(caminho: string | null, secao: string): AcaoWikilink {
  return caminho ? { tipo: 'navegar', caminho, secao } : { tipo: 'faltante' };
}

/** Porte literal da varredura de cabeçalhos de Markdown.ts do Life SO. */
export function recortarSecao(texto: string, secao: string): string {
  if (!secao) return texto;
  const linhas = texto.split(/\r\n|\r|\n/);
  const alvo = secao.replace(/^\^/, '').trim().toLowerCase();
  const cabecalhos = listarCabecalhos(texto);
  const indice = cabecalhos.findIndex(
    ({ titulo }) => titulo.toLocaleLowerCase('pt-BR') === alvo,
  );
  if (indice < 0) return '';
  const inicio = cabecalhos[indice];
  const seguinte = cabecalhos
    .slice(indice + 1)
    .find(({ nivel }) => nivel <= inicio.nivel);
  return linhas.slice(inicio.linha, seguinte?.linha).join('\n');
}

function regraWikilink(state: StateInline, silent: boolean): boolean {
  const { src } = state;
  let i = state.pos;
  const embed = src.charCodeAt(i) === 0x21;
  if (embed) i += 1;
  if (src.charCodeAt(i) !== 0x5b || src.charCodeAt(i + 1) !== 0x5b) return false;
  const fim = src.indexOf(']]', i + 2);
  if (fim < 0) return false;
  const bruto = src.slice(i + 2, fim);
  if (!bruto.trim() || bruto.includes('\n') || bruto.includes('[')) return false;
  const alvo = analisarAlvo(bruto, embed);
  if (!alvo.alvo && !alvo.secao) return false;
  if (!silent) {
    const token = state.push('wikilink', '', 0);
    token.content = bruto;
    token.meta = alvo;
  }
  state.pos = fim + 2;
  return true;
}

const TAREFA = /^\[([ xX])\]\s+/;

function regraTarefas(state: StateCore): void {
  const { tokens } = state;
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].type !== 'inline') continue;
    const m = TAREFA.exec(tokens[i].content);
    if (!m || tokens[i - 1]?.type !== 'paragraph_open') continue;
    const item = tokens[i - 2];
    if (!item || item.type !== 'list_item_open') continue;
    tokens[i].content = tokens[i].content.slice(m[0].length);
    const filho = tokens[i].children?.[0];
    if (filho?.type === 'text') filho.content = filho.content.replace(TAREFA, '');
    item.attrJoin('class', 'nota-tarefa');
    const caixa = new state.Token('html_inline', '', 0);
    caixa.content = `<input type="checkbox" class="nota-caixa" disabled${
      m[1] === ' ' ? '' : ' checked'
    } /> `;
    tokens[i].children?.unshift(caixa);
  }
}

/**
 * Sai sem `src`: quem preenche é `hidratarImagens`, depois da sanitização, para
 * que nenhuma data URL precise atravessar o DOMPurify.
 */
function marcacaoDeImagem(alvo: string, rotulo: string): string {
  const { alt, largura } = atributosDaImagem(alvo, rotulo);
  const atributoLargura = largura === null ? '' : ` width="${largura}"`;
  return `<img class="nota-imagem" data-anexo="${escapar(alvo)}" alt="${escapar(
    alt,
  )}"${atributoLargura}>`;
}

function criarMarkdown(ctx: ContextoMarkdown): MarkdownIt {
  const md = new MarkdownIt({ html: true, linkify: false, breaks: true });
  md.inline.ruler.before('link', 'wikilink', regraWikilink);
  md.core.ruler.push('tarefas_vault', (state) => {
    regraTarefas(state);
    return true;
  });
  md.renderer.rules.wikilink = (tokens, indice) => {
    const alvo = tokens[indice].meta as AlvoWikilink;
    if (alvo.embed) {
      if (ehImagem(alvo.alvo)) {
        return marcacaoDeImagem(alvo.alvo, rotuloDoEmbed(alvo));
      }
      return escapar(`![[${alvo.bruto}]]`);
    }
    const destino = alvo.alvo
      ? resolverWikilink(ctx.caminhos ?? [], ctx.caminhoAtual ?? '', alvo.alvo)
      : alvo.secao
        ? ctx.caminhoAtual ?? null
        : null;
    const classe = destino ? 'nota-link-existente' : 'nota-link-faltante';
    const atributoDestino = destino ? ` data-caminho="${escapar(destino)}"` : '';
    return `<a class="nota-link ${classe}" href="#" data-alvo="${escapar(
      alvo.alvo,
    )}" data-secao="${escapar(alvo.secao)}"${atributoDestino}>${escapar(alvo.texto)}</a>`;
  };
  md.renderer.rules.image = (tokens, indice) => {
    const token = tokens[indice];
    const origem = token.attrGet('src') ?? '';
    const titulo = token.attrGet('title');
    const sufixoTitulo = titulo ? ` "${titulo}"` : '';
    // Imagem remota fica como texto de propósito: renderizá-la entregaria o IP
    // do leitor ao servidor de terceiro a cada abertura da nota.
    const remota = /^(?:https?:|data:)/i.test(origem);
    if (!remota && ehImagem(origem)) return marcacaoDeImagem(origem, token.content);
    return escapar(`![${token.content}](${origem}${sufixoTitulo})`);
  };
  return md;
}

export function limparHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: [
      'script',
      'iframe',
      'object',
      'embed',
      'form',
      'style',
      'link',
      'meta',
      'base',
      'noscript',
    ],
    FORBID_ATTR: ['srcdoc', 'formaction', 'ping'],
    ADD_ATTR: ['disabled', 'checked'],
  }) as string;
}

export function renderizarMarkdown(texto: string, ctx: ContextoMarkdown = {}): string {
  return limparHtml(criarMarkdown(ctx).render(texto));
}

export function rolarParaSecao(
  container: HTMLElement,
  texto: string,
  secao: string,
): boolean {
  if (!recortarSecao(texto, secao)) return false;
  const alvo = secao.replace(/^\^/, '').trim().toLocaleLowerCase('pt-BR');
  const cabecalho = [...container.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')].find(
    (elemento) => elemento.textContent?.trim().toLocaleLowerCase('pt-BR') === alvo,
  );
  if (!cabecalho) return false;
  cabecalho.scrollIntoView?.({ block: 'start' });
  return true;
}
