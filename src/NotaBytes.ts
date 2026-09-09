import {
  EditorState,
  Facet,
  StateEffect,
  StateField,
  type Extension,
} from '@codemirror/state';
import { invertedEffects } from '@codemirror/commands';

// CM6 usa linhas lógicas. Os terminadores físicos são dados, não decoração.
// Cada transação conserva as quebras fora da edição; undo também restaura o mapa.
const restaurar = StateEffect.define<readonly string[]>();
const quebraNova = Facet.define<string, string>({
  combine: (valores) => valores[0] || '\n',
});
export const quebras = StateField.define<readonly string[]>({
  create: () => [],
  update(valor, tr) {
    // O histórico agrupa inversões da mais nova para a mais antiga. A última
    // representa o estado ANTES do grupo inteiro (apagar várias teclas/IME).
    for (let i = tr.effects.length - 1; i >= 0; i -= 1) {
      const efeito = tr.effects[i];
      if (efeito.is(restaurar)) return efeito.value;
    }
    if (!tr.docChanged) return valor;
    const resultado: string[] = [];
    let usado = 0;
    const padrao = tr.startState.facet(quebraNova);
    tr.changes.iterChanges((de, ate, _c, _d, inserido) => {
      const inicio = tr.startState.doc.lineAt(de).number - 1;
      const fim = tr.startState.doc.lineAt(ate).number - 1;
      for (let i = usado; i < inicio; i += 1) resultado.push(valor[i]);
      for (let i = 1; i < inserido.lines; i += 1) resultado.push(padrao);
      usado = fim;
    });
    for (let i = usado; i < valor.length; i += 1) resultado.push(valor[i]);
    return resultado;
  },
});

export function preservarQuebras(
  texto: string,
  eol: 'lf' | 'crlf' | 'misto',
): Extension {
  const originais = texto.match(/\r\n|\n/g) || [];
  return [
    // Parse de entrada continua aceitando ambos, inclusive colar texto CRLF.
    quebras.init(() => originais),
    invertedEffects.of((tr) =>
      tr.docChanged ? [restaurar.of(tr.startState.field(quebras))] : [],
    ),
    quebraNova.of(eol === 'crlf' ? '\r\n' : originais[0] || '\n'),
  ];
}

export function textoExato(state: EditorState): string {
  const eols = state.field(quebras);
  if (eols.length !== state.doc.lines - 1)
    throw new Error('Mapa de quebras inconsistente: salvamento recusado.');
  const linhas = state.doc.toString().split('\n');
  return linhas.map((linha, i) => linha + (eols[i] || '')).join('');
}

export function mesmoTexto(a: EditorState, b: EditorState): boolean {
  if (!a.doc.eq(b.doc)) return false;
  const aa = a.field(quebras);
  const bb = b.field(quebras);
  return (
    aa === bb || (aa.length === bb.length && aa.every((v, i) => v === bb[i]))
  );
}
