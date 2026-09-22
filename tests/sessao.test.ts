import { afterEach, describe, expect, it } from 'vitest';
import {
  branchAtual,
  definirSessao,
  pastaAtual,
  redefinirSessaoPadrao,
  repoAtual,
  sessaoAtual,
  sessaoPadrao,
} from '../src/sessao';

describe('sessão ativa (Fase 3, §3.3)', () => {
  afterEach(() => {
    redefinirSessaoPadrao();
  });

  it('começa no vault do Bruno por padrão', () => {
    expect(repoAtual()).toBe('brunojcbrg-cloud/vault-conhecimento');
    expect(branchAtual()).toBe('master');
    expect(pastaAtual()).toBe('06_Conhecimento/');
    expect(sessaoAtual()).toEqual(sessaoPadrao());
  });

  it('definirSessao troca repo, branch e pasta juntos', () => {
    definirSessao({ repo: 'brunojcbrg-cloud/vault-isabela', branch: 'main', pasta: '06_Conhecimento/' });
    expect(repoAtual()).toBe('brunojcbrg-cloud/vault-isabela');
    expect(branchAtual()).toBe('main');
  });

  it('redefinirSessaoPadrao volta ao vault do Bruno depois de trocar', () => {
    definirSessao({ repo: 'outra/coisa', branch: 'x', pasta: 'y/' });
    redefinirSessaoPadrao();
    expect(sessaoAtual()).toEqual(sessaoPadrao());
  });

  it('sessaoPadrao() nunca muda mesmo depois de definirSessao', () => {
    const padraoAntes = sessaoPadrao();
    definirSessao({ repo: 'outra/coisa', branch: 'x', pasta: 'y/' });
    expect(sessaoPadrao()).toEqual(padraoAntes);
  });

  it('sessaoAtual() devolve uma referência interna estável entre chamadas sem definirSessao', () => {
    expect(sessaoAtual()).toBe(sessaoAtual());
  });
});
