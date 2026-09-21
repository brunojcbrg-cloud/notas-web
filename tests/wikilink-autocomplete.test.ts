// @vitest-environment jsdom

import { CompletionContext, completionKeymap } from '@codemirror/autocomplete';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { describe, expect, it, vi } from 'vitest';
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

  it('em [[# oferece cabeçalhos do próprio documento e fecha a seção aceita', async () => {
    const state = estado('# Anatomia\n## Substância cinzenta\n\nVeja [[#subst');
    const fonte = fonteDeWikilinks({ caminhos: [], caminhoAtual: '06_Conhecimento/Atual.md' });
    const resultado = await fonte(new CompletionContext(state, state.doc.length, false));
    expect(resultado && 'options' in resultado ? resultado.options[0] : null).toMatchObject({
      label: 'Substância cinzenta',
      detail: 'H2',
      apply: 'Substância cinzenta]]',
    });
    expect(resultado?.from).toBe(state.doc.toString().lastIndexOf('#subst') + 1);
  });

  it('em [[Nome# mostra carregamento e reutiliza por SHA após uma chamada', async () => {
    const state = estado('Veja [[Medula Espinal#subst');
    let liberar: ((texto: string) => void) | undefined;
    const carregar = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          liberar = resolve;
        }),
    );
    const fonte = fonteDeWikilinks({
      caminhos: ['06_Conhecimento/Neuro/Medula Espinal.md'],
      caminhoAtual: '06_Conhecimento/Atual.md',
      blobs: new Map([['06_Conhecimento/Neuro/Medula Espinal.md', 'sha-medula']]),
      carregarSecoes: carregar,
    });
    const primeira = await fonte(new CompletionContext(state, state.doc.length, false));
    expect(primeira && 'options' in primeira ? primeira.options[0].label : '').toBe(
      'Carregando seções…',
    );
    expect(carregar).toHaveBeenCalledTimes(1);

    liberar?.('# Anatomia\n## Substância cinzenta');
    await Promise.resolve();
    const segunda = await fonte(new CompletionContext(state, state.doc.length, false));
    const terceira = await fonte(new CompletionContext(state, state.doc.length, false));
    expect(segunda && 'options' in segunda ? segunda.options[0] : null).toMatchObject({
      label: 'Substância cinzenta',
      apply: 'Substância cinzenta]]',
    });
    expect(terceira && 'options' in terceira ? terceira.options[0].label : '').toBe(
      'Substância cinzenta',
    );
    expect(carregar).toHaveBeenCalledTimes(1);
  });

  it('mantém setas, Enter e Esc do CodeMirror sem capturar Tab', () => {
    const teclas = completionKeymap.map(({ key }) => key);
    expect(teclas).toEqual(expect.arrayContaining(['ArrowDown', 'ArrowUp', 'Enter', 'Escape']));
    expect(teclas).not.toContain('Tab');
  });

  it('dá alvo de toque ao item sem backdrop-filter sobre o editor', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'style.css'), 'utf8');
    expect(css).toMatch(/@media \(pointer: coarse\)[\s\S]*\.cm-tooltip-autocomplete[^}]*min-height:\s*44px/);
    const regrasPopup = css.match(/\.cm-tooltip-autocomplete[^}]*\}/g)?.join('\n') ?? '';
    expect(regrasPopup).not.toContain('backdrop-filter');
  });
});
