// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { markdown } from '@codemirror/lang-markdown';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { configurarLivePreview, livePreview } from '../src/NotaLivePreview';
import { mesmoTexto, preservarQuebras, textoExato } from '../src/NotaBytes';

let view: EditorView | null = null;

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

function criarEditor(
  texto: string,
  eol: 'lf' | 'crlf' | 'misto',
  preview: Compartment,
  aoVivo = false,
): EditorView {
  const host = document.createElement('div');
  document.body.append(host);
  view = new EditorView({
    state: EditorState.create({
      doc: texto,
      extensions: [
        markdown(),
        preservarQuebras(texto, eol),
        preview.of(aoVivo ? livePreview() : []),
      ],
    }),
    parent: host,
  });
  return view;
}

describe('casos 61–65 · live preview sem edição implícita', () => {
  it('61. ligar o live preview e salvar sem editar preserva o texto byte a byte', () => {
    const original = '# Título\r\n\r\n**forte** e *itálico* com `código`\n> citação\r\n';
    const preview = new Compartment();
    const editor = criarEditor(original, 'misto', preview);
    configurarLivePreview(editor, preview, true);

    const salvo = textoExato(editor.state);
    expect(new TextEncoder().encode(salvo)).toEqual(new TextEncoder().encode(original));
    expect(document.querySelector('.cm-lp-h1')).not.toBeNull();
    expect(document.querySelector('.cm-lp-forte')).not.toBeNull();
    expect(document.querySelector('.cm-lp-enfase')).not.toBeNull();
    expect(document.querySelector('.cm-lp-codigo')).not.toBeNull();
    expect(document.querySelector('.cm-lp-citacao')).not.toBeNull();
    expect(document.querySelector('.cm-lp-marcador')).not.toBeNull();
    console.info(
      `Caso 61 — ${new TextEncoder().encode(salvo).length} bytes salvos / ${new TextEncoder().encode(original).length} originais: idênticos`,
    );
  });

  it('62. editar com live preview muda só a edição e preserva os terminadores', () => {
    const original = '# A\r\nlinha b\nlinha c\r\nfim';
    const preview = new Compartment();
    const editor = criarEditor(original, 'misto', preview, true);
    const inicio = editor.state.doc.toString().indexOf('b');
    editor.dispatch({ changes: { from: inicio, to: inicio + 1, insert: 'B' } });
    expect(textoExato(editor.state)).toBe('# A\r\nlinha B\nlinha c\r\nfim');
  });

  it('63. alternar Fonte, Leitura e Preview não toca o documento nem marca alteração', () => {
    const original = '# Intacto\r\ntexto\r\n';
    const preview = new Compartment();
    const editor = criarEditor(original, 'crlf', preview);
    const salvo = editor.state;

    configurarLivePreview(editor, preview, true); // Preview
    configurarLivePreview(editor, preview, false); // Leitura não decora o editor oculto
    configurarLivePreview(editor, preview, false); // Fonte

    expect(textoExato(editor.state)).toBe(original);
    expect(mesmoTexto(editor.state, salvo)).toBe(true);
    expect(editor.state.doc.eq(salvo.doc)).toBe(true);
  });

  it('64. nota CRLF editada no modo preview continua CRLF', () => {
    const original = 'um\r\ndois\r\ntrês\r\n';
    const preview = new Compartment();
    const editor = criarEditor(original, 'crlf', preview, true);
    const inicio = editor.state.doc.toString().indexOf('dois');
    editor.dispatch({ changes: { from: inicio, to: inicio + 4, insert: 'DOIS' } });
    expect(textoExato(editor.state)).toBe('um\r\nDOIS\r\ntrês\r\n');
  });

  it('65. modo Fonte mostra os marcadores crus', () => {
    const original = '# Título\n**forte** e *itálico*';
    const preview = new Compartment();
    const editor = criarEditor(original, 'lf', preview, true);
    configurarLivePreview(editor, preview, false);
    expect(editor.state.doc.toString()).toBe(original);
    expect(document.querySelector('.cm-content')?.textContent).toContain('# Título');
    expect(document.querySelector('.cm-content')?.textContent).toContain('**forte**');
    expect(document.querySelector('[class*="cm-lp-"]')).toBeNull();
  });
});

describe('casos 71–79 · marcadores de lista no live preview', () => {
  it('71. salvar sem editar preserva os bytes mesmo com marcador substituído', () => {
    const original = '- item\r\nlinha intacta\r\n';
    const preview = new Compartment();
    const editor = criarEditor(original, 'crlf', preview, true);
    editor.dispatch({ selection: { anchor: editor.state.doc.length } });

    expect(document.querySelector('.cm-lp-bolinha')).not.toBeNull();
    expect(new TextEncoder().encode(textoExato(editor.state))).toEqual(
      new TextEncoder().encode(original),
    );
  });

  it('72. hífen vira bolinha quando o cursor está em outra linha', () => {
    const original = '- item\noutra linha';
    const preview = new Compartment();
    const editor = criarEditor(original, 'lf', preview, true);
    editor.dispatch({ selection: { anchor: original.indexOf('outra') } });

    expect(document.querySelector('.cm-lp-bolinha')?.textContent).toBe('•');
    expect(document.querySelector('.cm-content')?.textContent).toContain('• item');
    expect(editor.state.doc.toString()).toBe(original);
  });

  it('73. cursor na linha mantém o hífen cru, visível e editável', () => {
    const preview = new Compartment();
    const editor = criarEditor('- item\noutra linha', 'lf', preview, true);

    expect(document.querySelector('.cm-lp-bolinha')).toBeNull();
    expect(document.querySelector('.cm-content')?.textContent).toContain('- item');
    expect(document.querySelector('.cm-lp-marcador')?.textContent).toBe('-');
  });

  it('74. seleção que atravessa a linha mantém o hífen cru', () => {
    const original = 'antes\n- item\ndepois';
    const preview = new Compartment();
    const editor = criarEditor(original, 'lf', preview, true);
    editor.dispatch({
      selection: { anchor: original.indexOf('antes') + 2, head: original.indexOf('depois') + 2 },
    });

    expect(document.querySelector('.cm-lp-bolinha')).toBeNull();
    expect(document.querySelector('.cm-content')?.textContent).toContain('- item');
  });

  it('75. três níveis usam a árvore para bolinha e recuo crescentes', () => {
    const original = '- um\n  - dois\n    - três\nfim';
    const preview = new Compartment();
    const editor = criarEditor(original, 'lf', preview, true);
    editor.dispatch({ selection: { anchor: original.indexOf('fim') } });

    const bolinhas = [...document.querySelectorAll<HTMLElement>('.cm-lp-bolinha')];
    expect(bolinhas.map((elemento) => elemento.textContent)).toEqual(['•', '◦', '▪']);
    expect(bolinhas.map((elemento) => elemento.classList.item(1))).toEqual([
      'cm-lp-bolinha-n1',
      'cm-lp-bolinha-n2',
      'cm-lp-bolinha-n3',
    ]);
    const linhas = [...document.querySelectorAll<HTMLElement>('.cm-line.cm-lp-lista')];
    expect(linhas.map((linha) => linha.style.getPropertyValue('--nivel').trim())).toEqual([
      '1',
      '2',
      '3',
    ]);
    const css = readFileSync('src/style.css', 'utf8');
    expect(css).toContain(
      'padding-left: calc(0.45em + (var(--nivel) - 1) * 0.75em)',
    );
  });

  it('76. lista ordenada preserva o número e não cria bolinha', () => {
    const original = '1. primeiro\nfim';
    const preview = new Compartment();
    const editor = criarEditor(original, 'lf', preview, true);
    editor.dispatch({ selection: { anchor: original.indexOf('fim') } });

    expect(document.querySelector('.cm-lp-bolinha')).toBeNull();
    expect(document.querySelector('.cm-content')?.textContent).toContain('1. primeiro');
    expect(document.querySelector('.cm-lp-marcador')?.textContent).toBe('1.');
  });

  it('77. hífen dentro de bloco de código fica intocado', () => {
    const original = '```\n- código\n```\nfim';
    const preview = new Compartment();
    const editor = criarEditor(original, 'lf', preview, true);
    editor.dispatch({ selection: { anchor: original.indexOf('fim') } });

    expect(document.querySelector('.cm-lp-bolinha')).toBeNull();
    expect(document.querySelector('.cm-content')?.textContent).toContain('- código');
    expect(editor.state.doc.toString()).toBe(original);
  });

  it('78. apagar o hífen na linha ativa produz parágrafo comum coerente', () => {
    const preview = new Compartment();
    const editor = criarEditor('- item\nfim', 'lf', preview, true);
    editor.dispatch({ changes: { from: 0, to: 1, insert: '' } });

    expect(editor.state.doc.toString()).toBe(' item\nfim');
    expect(document.querySelector('.cm-lp-bolinha')).toBeNull();
    expect(document.querySelector('.cm-lp-marcador')).toBeNull();
    expect(document.querySelector('.cm-content')?.textContent).toContain(' item');
  });

  it('79. nota CRLF editada no modo ao vivo continua CRLF', () => {
    const original = '- um\r\n- dois\r\nfim\r\n';
    const preview = new Compartment();
    const editor = criarEditor(original, 'crlf', preview, true);
    const inicio = editor.state.doc.toString().indexOf('dois');
    editor.dispatch({
      selection: { anchor: inicio },
      changes: { from: inicio, to: inicio + 4, insert: 'DOIS' },
    });

    expect(textoExato(editor.state)).toBe('- um\r\n- DOIS\r\nfim\r\n');
  });
});
