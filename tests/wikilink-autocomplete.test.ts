// @vitest-environment jsdom

import { CompletionContext } from '@codemirror/autocomplete';
import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { fonteDeWikilinks, gatilhoWikilink } from '../src/WikilinkAutocomplete';

function estado(texto: string, posicao = texto.length): EditorState {
  return EditorState.create({
    doc: texto,
    selection: { anchor: posicao },
    extensions: [markdown()],
  });
}

describe('gatilho de sugestão de wikilink', () => {
  it('reconhece o wikilink aberto e oferece nome sem caminho nem .md', async () => {
    const state = estado('Veja [[medu');
    expect(gatilhoWikilink(state, state.doc.length)).toEqual({ from: 7, digitado: 'medu' });
    const fonte = fonteDeWikilinks({
      caminhos: ['06_Conhecimento/Neuro/Medula Espinal.md'],
      caminhoAtual: '06_Conhecimento/Neuro/Atual.md',
    });
    const resultado = await fonte(new CompletionContext(state, state.doc.length, false));
    expect(resultado && 'options' in resultado ? resultado.options[0] : null).toMatchObject({
      label: 'Medula Espinal',
      detail: 'Neuro',
      apply: 'Medula Espinal]]',
    });
  });

  it('não dispara para embed nem depois de fechamento na mesma linha', () => {
    for (const texto of ['![[medu', '[[Fechada]] depois']) {
      const state = estado(texto);
      expect(gatilhoWikilink(state, state.doc.length)).toBeNull();
    }
  });

  it('não dispara dentro de código inline ou cercado', () => {
    for (const [texto, posicao] of [
      ['`[[medu`', 7],
      ['```md\n[[medu\n```', 12],
    ] as const) {
      const state = estado(texto, posicao);
      expect(gatilhoWikilink(state, posicao)).toBeNull();
    }
  });

  it('recusa apelido durante o alvo, que fica fora deste handoff', () => {
    const state = estado('[[Nota|apelido');
    expect(gatilhoWikilink(state, state.doc.length)).toBeNull();
  });
});
