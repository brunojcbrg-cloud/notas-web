import { describe, expect, it } from 'vitest';
import { ErroPasse, validarPasse } from '../src/passe';

const passeValido = () => ({
  versao: 1,
  usuario: 'bela.nandes02@gmail.com',
  nome: 'Isabela',
  repo: 'brunojcbrg-cloud/vault-isabela',
  branch: 'master',
  pastaNotas: '06_Conhecimento/',
  token: 'github_pat_1234567890abcdef',
  materiaisFolderId: '1AbC_dEf-23',
});

describe('Fase 3, §3.3 · validação do passe.json', () => {
  it('aceita um passe bem formado e devolve só os campos do contrato', () => {
    const passe = validarPasse(passeValido());
    expect(passe).toEqual(passeValido());
  });

  it('recusa versão diferente de 1', () => {
    expect(() => validarPasse({ ...passeValido(), versao: 2 })).toThrow(ErroPasse);
  });

  it('recusa usuário sem @ (não é e-mail)', () => {
    expect(() => validarPasse({ ...passeValido(), usuario: 'isabela' })).toThrow(ErroPasse);
  });

  it('recusa repo fora do formato dono/repositório', () => {
    expect(() => validarPasse({ ...passeValido(), repo: 'repo-sem-dono' })).toThrow(ErroPasse);
  });

  it('recusa repo com path traversal disfarçado', () => {
    expect(() => validarPasse({ ...passeValido(), repo: '../etc/passwd' })).toThrow(ErroPasse);
  });

  it('recusa pastaNotas sem barra final', () => {
    expect(() => validarPasse({ ...passeValido(), pastaNotas: '06_Conhecimento' })).toThrow(ErroPasse);
  });

  it('recusa pastaNotas com ..', () => {
    expect(() => validarPasse({ ...passeValido(), pastaNotas: '../06_Conhecimento/' })).toThrow(ErroPasse);
  });

  it('recusa pastaNotas absoluta', () => {
    expect(() => validarPasse({ ...passeValido(), pastaNotas: '/06_Conhecimento/' })).toThrow(ErroPasse);
  });

  it('recusa token curto demais para ser um PAT de verdade', () => {
    expect(() => validarPasse({ ...passeValido(), token: 'abc' })).toThrow(ErroPasse);
  });

  it('recusa materiaisFolderId com caractere fora do alfabeto de id do Drive', () => {
    expect(() => validarPasse({ ...passeValido(), materiaisFolderId: 'id com espaço' })).toThrow(ErroPasse);
  });

  it('recusa nome vazio ou só espaços', () => {
    expect(() => validarPasse({ ...passeValido(), nome: '   ' })).toThrow(ErroPasse);
  });

  it('recusa valor que não é objeto', () => {
    expect(() => validarPasse('passe.json')).toThrow(ErroPasse);
    expect(() => validarPasse(null)).toThrow(ErroPasse);
    expect(() => validarPasse([1, 2, 3])).toThrow(ErroPasse);
  });

  it('recusa campo faltando (branch ausente)', () => {
    const { branch: _branch, ...semBranch } = passeValido();
    expect(() => validarPasse(semBranch)).toThrow(ErroPasse);
  });
});
