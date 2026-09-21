import { describe, expect, it } from 'vitest';
import { sugerirNotas } from '../src/sugestoes';

const caminhos = [
  '06_Conhecimento/Neuro/Medula Espinal.md',
  '06_Conhecimento/Neuro/Sem título.md',
  '06_Conhecimento/Outra/Meninges.md',
  '06_Conhecimento/Outra/Sem título.md',
  '06_Conhecimento/Outra/Árvore brônquica.md',
  '06_Conhecimento/Outra/Zinco.md',
];

describe('sugestões de nota', () => {
  it('prioriza começo, depois ocorrência interna e por fim o restante', () => {
    expect(
      sugerirNotas(caminhos, '06_Conhecimento/Neuro/Atual.md', 'med').map(
        ({ nome }) => nome,
      ),
    ).toEqual([
      'Medula Espinal',
      'Sem título',
      'Árvore brônquica',
      'Meninges',
      'Sem título',
      'Zinco',
    ]);
  });

  it('ignora caixa e acentos ao classificar', () => {
    expect(sugerirNotas(caminhos, '', 'arvore')[0].nome).toBe('Árvore brônquica');
    expect(sugerirNotas(caminhos, '', 'TÍTULO')[0].nome).toBe('Sem título');
  });

  it('mantém homônimos separados, mostra suas pastas e prefere a pasta atual', () => {
    const repetidas = sugerirNotas(
      caminhos,
      '06_Conhecimento/Neuro/Atual.md',
      'sem título',
    ).filter(({ nome }) => nome === 'Sem título');
    expect(repetidas).toEqual([
      {
        nome: 'Sem título',
        caminho: '06_Conhecimento/Neuro/Sem título.md',
        pasta: 'Neuro',
      },
      {
        nome: 'Sem título',
        caminho: '06_Conhecimento/Outra/Sem título.md',
        pasta: 'Outra',
      },
    ]);
  });

  it('não usa fuzzy de letras soltas', () => {
    const nomes = sugerirNotas(caminhos, '', 'mdu').map(({ nome }) => nome);
    expect(nomes[0]).not.toBe('Medula Espinal');
  });
});
