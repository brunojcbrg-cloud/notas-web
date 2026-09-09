import { history, redo, undo } from '@codemirror/commands';
import { EditorState, type Transaction } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { codificarBase64, codificarEstado, decodificarBase64 } from '../src/bytes';
import { preservarQuebras, quebras, textoExato } from '../src/NotaBytes';

function estado(texto: string, eol: 'lf' | 'crlf' | 'misto' = 'lf'): EditorState {
  return EditorState.create({ doc: texto, extensions: [preservarQuebras(texto, eol)] });
}

describe('casos 1–10 · bytes e terminadores', () => {
  it('1. base64 → texto preserva acento e emoji', () => {
    const original = 'Semiologia: coração, ação e 🫀';
    expect(decodificarBase64(codificarBase64(original, false)).texto).toBe(original);
  });

  it('2. texto → base64 → texto preserva os bytes', () => {
    const original = 'Árvore\r\nlinha mista\núltima 🤓';
    const base64 = codificarBase64(original, false);
    expect(codificarBase64(decodificarBase64(base64).texto, false)).toBe(base64);
  });

  it('3. nota sem quebra final continua sem quebra final', () => {
    expect(textoExato(estado('primeira\núltima'))).toBe('primeira\núltima');
  });

  it('4. nota com quebra final continua com quebra final', () => {
    expect(textoExato(estado('primeira\núltima\n'))).toBe('primeira\núltima\n');
  });

  it('5. BOM fica fora do editor e volta ao arquivo gravado', () => {
    const base64 = codificarBase64('ação', true);
    const nota = decodificarBase64(base64);
    expect(nota.texto).toBe('ação');
    expect(nota.tinhaBom).toBe(true);
    expect(codificarBase64(nota.texto, nota.tinhaBom)).toBe(base64);
  });

  it('6. CRLF continua CRLF depois de editar uma linha', () => {
    let atual = estado('a\r\nb\r\nc', 'crlf');
    atual = atual.update({ changes: { from: 2, to: 3, insert: 'B' } }).state;
    expect(textoExato(atual)).toBe('a\r\nB\r\nc');
  });

  it('7. fim de linha misto é preservado exatamente', () => {
    let atual = estado('a\r\nb\nc\r\nd', 'misto');
    atual = atual.update({ changes: { from: 4, to: 5, insert: 'C' } }).state;
    expect(textoExato(atual)).toBe('a\r\nb\nC\r\nd');
  });

  it('8. CR isolado marca somente-leitura e recusa gravação', () => {
    const nota = decodificarBase64(codificarBase64('a\rb', false));
    expect(nota.somenteLeitura).toBe(true);
    expect(() => codificarEstado(estado(nota.texto), false, nota.somenteLeitura)).toThrow(
      'CR isolado',
    );
  });

  it('9. mapa de quebras inconsistente lança e recusa gravação', () => {
    const inconsistente = EditorState.create({ doc: 'a\nb', extensions: [quebras] });
    expect(() => textoExato(inconsistente)).toThrow('Mapa de quebras inconsistente');
  });

  it('10. edição CRLF no meio, undo e redo restauram o mapa', () => {
    let atual = EditorState.create({
      doc: 'a\r\nb\r\nc',
      extensions: [history(), preservarQuebras('a\r\nb\r\nc', 'crlf')],
    });
    const dispatch = (tr: Transaction): void => {
      atual = tr.state;
    };
    dispatch(atual.update({ changes: { from: 2, to: 3, insert: 'B' } }));
    expect(textoExato(atual)).toBe('a\r\nB\r\nc');
    expect(undo({ state: atual, dispatch })).toBe(true);
    expect(textoExato(atual)).toBe('a\r\nb\r\nc');
    expect(redo({ state: atual, dispatch })).toBe(true);
    expect(textoExato(atual)).toBe('a\r\nB\r\nc');
  });
});
