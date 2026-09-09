// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import {
  BloqueioInatividade,
  conectarBloqueio,
  LIMITE_INATIVIDADE_MS,
  LIMITE_OCULTA_MS,
} from '../src/lock';
import { CHAVE_TOKEN, guardarToken, sair, type ArmazenamentoSessao } from '../src/session';
import { mesmoTexto, preservarQuebras, textoExato } from '../src/NotaBytes';

describe('casos 43–47 · bloqueio', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('43. quinze minutos sem interação trancam a página', () => {
    const trancar = vi.fn();
    const controlador = new BloqueioInatividade(trancar);
    controlador.iniciar();
    vi.advanceTimersByTime(LIMITE_INATIVIDADE_MS - 1);
    expect(trancar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(trancar).toHaveBeenCalledOnce();
  });

  it('44. aba escondida por cinco minutos tranca a página', () => {
    const trancar = vi.fn();
    const controlador = new BloqueioInatividade(trancar);
    controlador.iniciar();
    controlador.visibilidadeMudou(true);
    vi.advanceTimersByTime(LIMITE_OCULTA_MS - 1);
    expect(trancar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(trancar).toHaveBeenCalledOnce();
  });

  it('45. tecla, clique e rolagem zeram o relógio de inatividade', () => {
    const trancar = vi.fn();
    const controlador = new BloqueioInatividade(trancar);
    const desconectar = conectarBloqueio(controlador, window, document);
    vi.advanceTimersByTime(10 * 60 * 1000);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    vi.advanceTimersByTime(10 * 60 * 1000);
    window.dispatchEvent(new MouseEvent('click'));
    vi.advanceTimersByTime(10 * 60 * 1000);
    window.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(LIMITE_INATIVIDADE_MS - 1);
    expect(trancar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(trancar).toHaveBeenCalledOnce();
    desconectar();
  });

  it('46. bloqueio captura edição pendente na memória antes de limpar a sessão', () => {
    const textoSalvo = 'linha salva';
    const salvo = EditorState.create({
      doc: textoSalvo,
      extensions: [preservarQuebras(textoSalvo, 'lf')],
    });
    const editado = EditorState.create({
      doc: 'linha salva\nparágrafo ainda não gravado',
      extensions: [preservarQuebras('linha salva\nparágrafo ainda não gravado', 'lf')],
    });
    let rascunho: string | null = null;
    let token: string | null = 'segredo';
    const controlador = new BloqueioInatividade(() => {
      rascunho = textoExato(editado);
      token = null;
    });
    controlador.iniciar();
    vi.advanceTimersByTime(LIMITE_INATIVIDADE_MS);
    expect(rascunho).toBe('linha salva\nparágrafo ainda não gravado');
    expect(token).toBeNull();
    const textoRestaurado = rascunho ?? '';
    const restaurado = EditorState.create({
      doc: textoRestaurado,
      extensions: [preservarQuebras(textoRestaurado, 'lf')],
    });
    expect(mesmoTexto(restaurado, salvo)).toBe(false);
  });

  it('47. token fica ausente da sessionStorage depois do bloqueio', () => {
    const dados = new Map<string, string>();
    const storage: ArmazenamentoSessao = {
      getItem: (chave) => dados.get(chave) ?? null,
      setItem: (chave, valor) => dados.set(chave, valor),
      clear: () => dados.clear(),
    };
    guardarToken(storage, 'token-secreto');
    const controlador = new BloqueioInatividade(() => {
      sair(storage);
    });
    controlador.iniciar();
    vi.advanceTimersByTime(LIMITE_INATIVIDADE_MS);
    expect(storage.getItem(CHAVE_TOKEN)).toBeNull();
    expect(dados.size).toBe(0);
  });

  // O relogio falso do vitest aceita qualquer dono; o navegador nao. Este caso
  // reproduz a regra real: nativo chamado com receptor que nao seja o global
  // lanca "Illegal invocation". Sem ele, o defeito passa verde e quebra no ar.
  it('51. os agendadores padrao nao chamam o nativo com receptor errado', () => {
    vi.useRealTimers();
    const setOriginal = globalThis.setTimeout;
    const clearOriginal = globalThis.clearTimeout;
    const atrasos: number[] = [];
    let cancelados = 0;
    const exigirGlobal = (dono: unknown): void => {
      if (dono !== undefined && dono !== globalThis) {
        throw new TypeError('Illegal invocation');
      }
    };
    globalThis.setTimeout = function (this: unknown, _acao: unknown, atraso: number) {
      exigirGlobal(this);
      atrasos.push(atraso);
      return 1 as unknown as ReturnType<typeof setTimeout>;
    } as unknown as typeof setTimeout;
    globalThis.clearTimeout = function (this: unknown) {
      exigirGlobal(this);
      cancelados += 1;
    } as unknown as typeof clearTimeout;

    try {
      const controlador = new BloqueioInatividade(() => {});
      expect(() => controlador.iniciar()).not.toThrow();
      expect(() => controlador.interagir()).not.toThrow();
      expect(() => controlador.visibilidadeMudou(true)).not.toThrow();
      expect(() => controlador.parar()).not.toThrow();
      expect(atrasos).toEqual([
        LIMITE_INATIVIDADE_MS,
        LIMITE_INATIVIDADE_MS,
        LIMITE_OCULTA_MS,
      ]);
      expect(cancelados).toBeGreaterThan(0);
    } finally {
      globalThis.setTimeout = setOriginal;
      globalThis.clearTimeout = clearOriginal;
    }
  });
});
