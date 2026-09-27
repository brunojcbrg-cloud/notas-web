// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { avaliarSincronizacaoWeb, criarPainelSincronizacaoWeb, lerUltimaGravacao, registrarUltimaGravacao } from '../src/sincronizacao';
import type { RascunhoPersistente } from '../src/rascunhos';

const rascunho = (caminho = '06_Conhecimento/Nota.md'): RascunhoPersistente => ({
  versao: 1, caminho, texto: 'local', textoBase: 'base', shaBase: 'sha-antigo',
  tinhaBom: false, somenteLeitura: false, eol: 'lf', pastaRetorno: '', atualizadoEm: 10,
});

describe('painel de sincronização web', () => {
  beforeEach(() => localStorage.clear());

  it('persiste a última gravação e o resultado', () => {
    registrarUltimaGravacao(localStorage, { em: 42, resultado: 'salvo', caminho: 'Nota.md' });
    expect(lerUltimaGravacao(localStorage)).toEqual({ em: 42, resultado: 'salvo', caminho: 'Nota.md' });
  });

  it('fica atualizado sem rascunhos e com o mesmo SHA', () => {
    const estado = avaliarSincronizacaoWeb({ rascunhos: [], caminhoAberto: 'Nota.md', shaAberto: 'abc', shaRemoto: 'abc', ultima: null });
    expect(estado.tipo).toBe('atualizado');
  });

  it('mostra rascunhos ainda não confirmados', () => {
    expect(avaliarSincronizacaoWeb({ rascunhos: [rascunho()], ultima: null }).tipo).toBe('rascunhos');
  });

  it('edge case: prioriza conflito remoto quando também existe rascunho local', () => {
    const estado = avaliarSincronizacaoWeb({
      rascunhos: [rascunho()], caminhoAberto: 'Nota.md', shaAberto: 'antigo', shaRemoto: 'novo', ultima: null,
    });
    expect(estado.tipo).toBe('remoto-alterado');
    expect(estado.descricao).toMatch(/rascunho local/);
  });

  it('renderiza erro sem esconder os rascunhos', () => {
    const estado = avaliarSincronizacaoWeb({ rascunhos: [rascunho()], ultima: null, erro: 'sem rede' });
    const painel = criarPainelSincronizacaoWeb(estado, () => {});
    expect(painel.textContent).toContain('sem rede');
    expect(painel.textContent).toContain('06_Conhecimento/Nota.md');
  });
});
