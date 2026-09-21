import {
  autocompletion,
  startCompletion,
  type CompletionContext,
  type CompletionSource,
} from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import type { EditorState, Extension } from '@codemirror/state';
import { dentroDeCodigo } from './NotaLivePreview';
import { sugerirCabecalhos, sugerirNotas } from './sugestoes';
import { resolverWikilink } from './markdown';

export interface OpcoesWikilinkAutocomplete {
  caminhos: readonly string[];
  caminhoAtual: string;
  blobs?: ReadonlyMap<string, string>;
  carregarSecoes?: (caminho: string, sha: string) => Promise<string>;
}

type EntradaSecoes =
  | { estado: 'carregando' }
  | { estado: 'pronto'; texto: string }
  | { estado: 'erro' };

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
  const cachePorSha = new Map<string, EntradaSecoes>();

  return (contexto: CompletionContext) => {
    const gatilho = gatilhoWikilink(contexto.state, contexto.pos);
    if (!gatilho) return null;
    if (gatilho.digitado.startsWith('#')) {
      const digitado = gatilho.digitado.slice(1);
      return {
        from: gatilho.from + 1,
        filter: false,
        options: sugerirCabecalhos(contexto.state.doc.toString(), digitado).map(
          ({ titulo, nivel }) => ({
            label: titulo,
            detail: `H${nivel}`,
            type: 'property',
            apply: `${titulo}]]`,
          }),
        ),
      };
    }
    const separador = gatilho.digitado.indexOf('#');
    if (separador > 0) {
      const alvo = gatilho.digitado.slice(0, separador).trim();
      const caminho = resolverWikilink(opcoes.caminhos, opcoes.caminhoAtual, alvo);
      const sha = caminho ? opcoes.blobs?.get(caminho) : undefined;
      const from = gatilho.from + separador + 1;
      if (!caminho || !sha || !opcoes.carregarSecoes) {
        return {
          from,
          filter: false,
          options: [{ label: 'Nota não encontrada', type: 'text', apply: () => undefined }],
        };
      }
      let entrada = cachePorSha.get(sha);
      if (!entrada) {
        entrada = { estado: 'carregando' };
        cachePorSha.set(sha, entrada);
        void opcoes.carregarSecoes(caminho, sha).then(
          (texto) => {
            cachePorSha.set(sha, { estado: 'pronto', texto });
            if (contexto.view) startCompletion(contexto.view);
          },
          () => {
            cachePorSha.set(sha, { estado: 'erro' });
            if (contexto.view) startCompletion(contexto.view);
          },
        );
      }
      if (entrada.estado === 'carregando') {
        return {
          from,
          filter: false,
          options: [{ label: 'Carregando seções…', type: 'text', apply: () => undefined }],
        };
      }
      if (entrada.estado === 'erro') {
        return {
          from,
          filter: false,
          options: [{ label: 'Não foi possível carregar as seções', type: 'text', apply: () => undefined }],
        };
      }
      const digitado = gatilho.digitado.slice(separador + 1);
      return {
        from,
        filter: false,
        options: sugerirCabecalhos(entrada.texto, digitado).map(({ titulo, nivel }) => ({
          label: titulo,
          detail: `H${nivel}`,
          type: 'property',
          apply: `${titulo}]]`,
        })),
      };
    }
    if (separador === 0) return null;
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
