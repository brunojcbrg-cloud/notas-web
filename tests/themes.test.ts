import { describe, expect, it } from 'vitest';
import {
  CAMPOS_MARKDOWN,
  CHAVE_TEMA,
  guardarPreferenciaTema,
  lerPreferenciaTema,
  PALETAS_MARKDOWN,
  especificacoesRealce,
  type ArmazenamentoTema,
} from '../src/themes';
import { tags } from '@lezer/highlight';

describe('casos 35–37 · paletas copiadas e preferência', () => {
  it('35. compara valor a valor as 13 cores OBSIDIAN claras e escuras do Kotlin', () => {
    expect(CAMPOS_MARKDOWN).toHaveLength(13);
    expect(PALETAS_MARKDOWN.obsidian.dark).toEqual({
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
    });
    expect(PALETAS_MARKDOWN.obsidian.light).toEqual({
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
    });
  });

  it('36. compara valor a valor as 13 cores SOLARIZED claras e escuras do Kotlin', () => {
    expect(CAMPOS_MARKDOWN).toHaveLength(13);
    expect(PALETAS_MARKDOWN.solarized.dark).toEqual({
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
    });
    expect(PALETAS_MARKDOWN.solarized.light).toEqual({
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
    });
  });

  it('37. tema e modo escolhidos sobrevivem ao recarregar via localStorage', () => {
    const dados = new Map<string, string>();
    const storage: ArmazenamentoTema = {
      getItem: (chave) => dados.get(chave) ?? null,
      setItem: (chave, valor) => dados.set(chave, valor),
    };
    guardarPreferenciaTema(storage, { tema: 'solarized', modo: 'dark' });
    expect(dados.has(CHAVE_TEMA)).toBe(true);
    expect(lerPreferenciaTema(storage)).toEqual({ tema: 'solarized', modo: 'dark' });
  });
});

describe('caso 70 · realce nao inunda o texto com a cor do marcador', () => {
  it('70. tags.list fica de fora e italico, negrito e marcador tem cores distintas', () => {
    const paleta = PALETAS_MARKDOWN.obsidian.light;
    const especificacoes = especificacoesRealce(paleta);
    const etiquetas = especificacoes.flatMap((e) => (Array.isArray(e.tag) ? e.tag : [e.tag]));

    // "OrderedList/... BulletList/..." aplica tags.list a TODOS os descendentes:
    // pintar essa etiqueta deixava cada linha de lista inteira de uma cor so.
    expect(etiquetas).not.toContain(tags.list);
    expect(etiquetas).toContain(tags.processingInstruction);

    const cor = (alvo: (typeof tags)[keyof typeof tags]): string | undefined =>
      especificacoes.find((e) => (Array.isArray(e.tag) ? e.tag : [e.tag]).includes(alvo))?.color;

    const italico = cor(tags.emphasis);
    const negrito = cor(tags.strong);
    const marcador = cor(tags.processingInstruction);
    expect(italico).toBe(paleta.emphasis);
    expect(negrito).toBe(paleta.emphasis2);
    expect(new Set([italico, negrito, marcador]).size).toBe(3);
  });
});

describe('caso 80 · cores por nível de cabeçalho', () => {
  it('80. heading1, heading2 e heading3 usam três valores distintos da paleta', () => {
    const paleta = PALETAS_MARKDOWN.obsidian.light;
    const especificacoes = especificacoesRealce(paleta);
    const cor = (alvo: (typeof tags)[keyof typeof tags]): string | undefined =>
      especificacoes.find((e) => (Array.isArray(e.tag) ? e.tag : [e.tag]).includes(alvo))?.color;

    const cores = [cor(tags.heading1), cor(tags.heading2), cor(tags.heading3)];
    expect(cores).toEqual([paleta.h1, paleta.h2, paleta.h3]);
    expect(new Set(cores).size).toBe(3);
  });
});
