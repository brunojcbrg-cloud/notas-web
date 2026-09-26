// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AgendadorAutosave,
  apagarRascunho,
  ATRASO_AUTOSAVE_MS,
  guardarRascunho,
  lerRascunho,
  listarRascunhos,
  salvarAntesDeTrancar,
  type RascunhoPersistente,
} from '../src/rascunhos';
import { BloqueioInatividade, LIMITE_OCULTA_MS } from '../src/lock';

function rascunho(texto = 'edição local'): RascunhoPersistente {
  return {
    versao: 1,
    caminho: '06_Conhecimento/Nota.md',
    texto,
    textoBase: 'texto remoto',
    shaBase: 'abc123',
    tinhaBom: false,
    somenteLeitura: false,
    eol: 'lf',
    pastaRetorno: '06_Conhecimento',
    atualizadoEm: 123,
  };
}

describe('rascunho persistente e autosave', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('232. persiste por caminho sem token e sobrevive a uma nova leitura', () => {
    guardarRascunho(localStorage, rascunho());
    const restaurado = lerRascunho(localStorage, '06_Conhecimento/Nota.md');
    expect(restaurado?.texto).toBe('edição local');
    expect(JSON.stringify(restaurado)).not.toContain('token');
    expect(listarRascunhos(localStorage)).toHaveLength(1);
    apagarRascunho(localStorage, '06_Conhecimento/Nota.md');
    expect(lerRascunho(localStorage, '06_Conhecimento/Nota.md')).toBeNull();
  });

  it('233. salva cinco segundos após a última alteração', async () => {
    const salvar = vi.fn(async () => true);
    const agendador = new AgendadorAutosave(salvar);
    agendador.alterou();
    vi.advanceTimersByTime(4_000);
    agendador.alterou();
    await vi.advanceTimersByTimeAsync(ATRASO_AUTOSAVE_MS - 1);
    expect(salvar).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(salvar).toHaveBeenCalledOnce();
  });

  it('234. ocultar salva antes de trancar', async () => {
    const ordem: string[] = [];
    const concluiu = await salvarAntesDeTrancar(
      () => { ordem.push('rascunho'); return true; },
      async () => { ordem.push('github'); return true; },
      () => { ordem.push('tranca'); },
    );
    expect(concluiu).toBe(true);
    expect(ordem).toEqual(['rascunho', 'github', 'tranca']);
  });

  it('235. falha no GitHub mantém o rascunho e ainda tranca', async () => {
    guardarRascunho(localStorage, rascunho('texto exato após recarga'));
    const ordem: string[] = [];
    await salvarAntesDeTrancar(
      () => true,
      async () => { ordem.push('falhou'); throw new Error('sem rede'); },
      () => { ordem.push('tranca'); },
    );
    expect(ordem).toEqual(['falhou', 'tranca']);
    expect(lerRascunho(localStorage, '06_Conhecimento/Nota.md')?.texto)
      .toBe('texto exato após recarga');
  });

  it('236. relógio oculto grava no GitHub antes de limpar a sessão', async () => {
    const ordem: string[] = [];
    const controlador = new BloqueioInatividade(() => salvarAntesDeTrancar(
      () => { ordem.push('rascunho'); return true; },
      async () => { ordem.push('github: texto digitado'); return true; },
      () => { ordem.push('sessão limpa'); },
    ));
    controlador.iniciar();
    controlador.visibilidadeMudou(true);
    await vi.advanceTimersByTimeAsync(LIMITE_OCULTA_MS);
    expect(ordem).toEqual(['rascunho', 'github: texto digitado', 'sessão limpa']);
  });
});
