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
  let inicio = -1;
  let nivel = 0;
  for (let i = 0; i < linhas.length; i += 1) {
    const m = /^(#{1,6})\s+(.*)$/.exec(linhas[i]);
    if (!m) continue;
    if (inicio < 0) {
      if (m[2].trim().toLowerCase() === alvo) {
        inicio = i;
        nivel = m[1].length;
      }
      continue;
    }
    if (m[1].length <= nivel) return linhas.slice(inicio, i).join('\n');
  }
  return inicio < 0 ? '' : linhas.slice(inicio).join('\n');
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
  const largura = larguraDoRotulo(rotulo);
  const alt = rotulo && largura === null ? rotulo : nomeDoArquivo(alvo);
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
        return marcacaoDeImagem(alvo.alvo, alvo.texto === alvo.alvo ? '' : alvo.texto);
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
