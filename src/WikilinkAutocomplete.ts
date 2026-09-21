import {
  autocompletion,
  type CompletionContext,
  type CompletionSource,
} from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import type { EditorState, Extension } from '@codemirror/state';
import { dentroDeCodigo } from './NotaLivePreview';
import { sugerirNotas } from './sugestoes';

export interface OpcoesWikilinkAutocomplete {
  caminhos: readonly string[];
  caminhoAtual: string;
}

export interface GatilhoWikilink {
  /** Primeiro caractere digitado depois de `[[`. */
  from: number;
  /** Texto entre `[[` e o cursor. */
  digitado: string;
}

/**
 * Reconhece somente um `[[` ainda aberto na linha atual.
 *
 * Usa a mesma árvore sintática do modo ao vivo para não transformar texto de
 * código em navegação. `![[` fica reservado para anexos.
 */
export function gatilhoWikilink(state: EditorState, posicao: number): GatilhoWikilink | null {
  const linha = state.doc.lineAt(posicao);
  const antes = state.sliceDoc(linha.from, posicao);
  const aberturaNaLinha = antes.lastIndexOf('[[');
  if (aberturaNaLinha < 0) return null;
  const abertura = linha.from + aberturaNaLinha;
  if (abertura > 0 && state.sliceDoc(abertura - 1, abertura) === '!') return null;
  if (antes.slice(aberturaNaLinha + 2).includes(']]')) return null;
  const arvore = syntaxTree(state);
  if (dentroDeCodigo(arvore, abertura) || dentroDeCodigo(arvore, Math.max(abertura, posicao - 1))) {
    return null;
  }
  const digitado = state.sliceDoc(abertura + 2, posicao);
  if (digitado.includes('[') || digitado.includes(']') || digitado.includes('|')) return null;
  return { from: abertura + 2, digitado };
}

export function fonteDeWikilinks(opcoes: OpcoesWikilinkAutocomplete): CompletionSource {
  return (contexto: CompletionContext) => {
    const gatilho = gatilhoWikilink(contexto.state, contexto.pos);
    if (!gatilho || gatilho.digitado.includes('#')) return null;
    return {
      from: gatilho.from,
      filter: false,
      options: sugerirNotas(
        opcoes.caminhos,
        opcoes.caminhoAtual,
        gatilho.digitado,
      ).map(({ nome, pasta }) => ({
        label: nome,
        detail: pasta || '06_Conhecimento',
        type: 'text',
        apply: `${nome}]]`,
      })),
    };
  };
}

export function sugestaoDeWikilinks(opcoes: OpcoesWikilinkAutocomplete): Extension {
  return autocompletion({ override: [fonteDeWikilinks(opcoes)] });
}
