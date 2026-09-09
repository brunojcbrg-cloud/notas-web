import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { tags } from '@lezer/highlight';

export const CAMPOS_MARKDOWN = [
  'h1',
  'h2',
  'h3',
  'h4',
  'emphasis',
  'emphasis2',
  'code',
  'codeBackground',
  'quote',
  'listMarker',
  'link',
  'highlight',
  'highlightBackground',
] as const;

export type CampoMarkdown = (typeof CAMPOS_MARKDOWN)[number];
export type PaletaMarkdown = Record<CampoMarkdown, string>;
export type TemaMarkdown = 'padrao' | 'obsidian' | 'solarized';
export type ModoCor = 'system' | 'light' | 'dark';

export interface PreferenciaTema {
  tema: TemaMarkdown;
  modo: ModoCor;
}

export interface ArmazenamentoTema {
  getItem(chave: string): string | null;
  setItem(chave: string, valor: string): void;
}

export const CHAVE_TEMA = 'notas-web.markdown-theme';
export const PREFERENCIA_PADRAO: PreferenciaTema = { tema: 'padrao', modo: 'system' };

// Cópia literal de MarkdownColorScheme.kt: não ajustar nem normalizar estes valores.
export const PALETAS_MARKDOWN = {
  obsidian: {
    dark: {
      h1: '#82AAFF',
      h2: '#89DDFF',
      h3: '#C792EA',
      h4: '#80CBC4',
      emphasis: '#F78C6C',
      emphasis2: '#FFCB6B',
      code: '#C3E88D',
      codeBackground: '#2D333B',
      quote: '#B0BEC5',
      listMarker: '#FFA726',
      link: '#80CBC4',
      highlight: '#FFE082',
      highlightBackground: '#5D4E20',
    },
    light: {
      h1: '#2457A7',
      h2: '#007C91',
      h3: '#7B3FA1',
      h4: '#26766F',
      emphasis: '#B63B1E',
      emphasis2: '#8A5B00',
      code: '#2E6B22',
      codeBackground: '#E7ECEF',
      quote: '#52606D',
      listMarker: '#C45A00',
      link: '#006B73',
      highlight: '#5D4300',
      highlightBackground: '#FFE8A3',
    },
  },
  solarized: {
    dark: {
      h1: '#268BD2',
      h2: '#2AA198',
      h3: '#6C71C4',
      h4: '#859900',
      emphasis: '#CB4B16',
      emphasis2: '#B58900',
      code: '#859900',
      codeBackground: '#073642',
      quote: '#93A1A1',
      listMarker: '#B58900',
      link: '#2AA198',
      highlight: '#FDF6E3',
      highlightBackground: '#586E75',
    },
    light: {
      h1: '#006FAD',
      h2: '#167A72',
      h3: '#5E63B6',
      h4: '#697D00',
      emphasis: '#B33A0E',
      emphasis2: '#8F6B00',
      code: '#5F7000',
      codeBackground: '#EEE8D5',
      quote: '#586E75',
      listMarker: '#9B7200',
      link: '#087E75',
      highlight: '#3B4A4E',
      highlightBackground: '#FFE9A6',
    },
  },
} as const satisfies Record<Exclude<TemaMarkdown, 'padrao'>, Record<'light' | 'dark', PaletaMarkdown>>;

export function guardarPreferenciaTema(
  storage: ArmazenamentoTema,
  preferencia: PreferenciaTema,
): void {
  storage.setItem(CHAVE_TEMA, JSON.stringify(preferencia));
}

export function lerPreferenciaTema(storage: ArmazenamentoTema): PreferenciaTema {
  try {
    const valor = storage.getItem(CHAVE_TEMA);
    if (!valor) return { ...PREFERENCIA_PADRAO };
    const lido = JSON.parse(valor) as Partial<PreferenciaTema>;
    const tema = ['padrao', 'obsidian', 'solarized'].includes(String(lido.tema))
      ? (lido.tema as TemaMarkdown)
      : 'padrao';
    const modo = ['system', 'light', 'dark'].includes(String(lido.modo))
      ? (lido.modo as ModoCor)
      : 'system';
    return { tema, modo };
  } catch {
    return { ...PREFERENCIA_PADRAO };
  }
}

export function modoEfetivo(modo: ModoCor, sistemaEscuro: boolean): 'light' | 'dark' {
  return modo === 'system' ? (sistemaEscuro ? 'dark' : 'light') : modo;
}

export function paletaEfetiva(
  preferencia: PreferenciaTema,
  sistemaEscuro: boolean,
): PaletaMarkdown | null {
  if (preferencia.tema === 'padrao') return null;
  return PALETAS_MARKDOWN[preferencia.tema][modoEfetivo(preferencia.modo, sistemaEscuro)];
}

export function aplicarTema(
  raiz: HTMLElement,
  preferencia: PreferenciaTema,
  sistemaEscuro: boolean,
): void {
  const modo = modoEfetivo(preferencia.modo, sistemaEscuro);
  raiz.dataset.temaMarkdown = preferencia.tema;
  raiz.dataset.modoCor = modo;
  const paleta = paletaEfetiva(preferencia, sistemaEscuro);
  for (const campo of CAMPOS_MARKDOWN) {
    const nome = `--md-${campo.replace(/[A-Z]/g, (letra) => `-${letra.toLowerCase()}`)}`;
    if (paleta) raiz.style.setProperty(nome, paleta[campo]);
    else raiz.style.removeProperty(nome);
  }
}

export function realceMarkdown(paleta: PaletaMarkdown | null): Extension {
  if (!paleta) return [];
  return syntaxHighlighting(
    HighlightStyle.define([
      { tag: tags.heading1, color: paleta.h1 },
      { tag: tags.heading2, color: paleta.h2 },
      { tag: tags.heading3, color: paleta.h3 },
      { tag: [tags.heading4, tags.heading5, tags.heading6], color: paleta.h4 },
      { tag: tags.emphasis, color: paleta.emphasis, fontStyle: 'italic' },
      { tag: tags.strong, color: paleta.emphasis2, fontWeight: 'bold' },
      { tag: tags.monospace, color: paleta.code, backgroundColor: paleta.codeBackground },
      { tag: tags.quote, color: paleta.quote },
      { tag: tags.list, color: paleta.listMarker },
      { tag: [tags.link, tags.url], color: paleta.link, textDecoration: 'underline' },
    ]),
  );
}
