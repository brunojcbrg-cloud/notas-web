// @vitest-environment jsdom

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
