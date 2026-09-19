import { describe, expect, it, vi } from 'vitest';
import {
  construirArvore,
  entradasDaPasta,
  filtrarNotas,
  nomeDaNota,
} from '../src/tree';

describe('casos 21–26 · árvore de pastas', () => {
  it('21. 136 caminhos viram 62 pastas com profundidade máxima 5', () => {
    const caminhos = [
      ...Array.from(
        { length: 57 },
        (_, i) => `06_Conhecimento/Pasta ${String(i + 1).padStart(2, '0')}/Nota.md`,
      ),
      '06_Conhecimento/Nível 1/Nível 2/Nível 3/Nível 4/Nível 5/Profunda.md',
      ...Array.from(
        { length: 78 },
        (_, i) => `06_Conhecimento/Raiz ${String(i + 1).padStart(2, '0')}.md`,
      ),
    ];
    const arvore = construirArvore(caminhos);
    expect(arvore.notas).toHaveLength(136);
    expect(arvore.totalPastas).toBe(62);
    expect(arvore.profundidadeMaxima).toBe(5);
  });

  it('22. contagem da pasta inclui notas das subpastas', () => {
    const arvore = construirArvore([
      '06_Conhecimento/Medicina/Direta.md',
      '06_Conhecimento/Medicina/Fisiologia/Uma.md',
      '06_Conhecimento/Medicina/Fisiologia/Neuro/Duas.md',
    ]);
    expect(arvore.pastas.get('Medicina')?.totalNotas).toBe(3);
    expect(arvore.pastas.get('Medicina/Fisiologia')?.totalNotas).toBe(2);
  });

  it('23. ordena pastas antes de notas e alfabeticamente em pt-BR', () => {
    const entradas = entradasDaPasta(
      construirArvore([
        '06_Conhecimento/Zebra.md',
        '06_Conhecimento/Biologia/Z.md',
        '06_Conhecimento/Árvore/Z.md',
        '06_Conhecimento/Ácido.md',
      ]),
    );
    expect(entradas.map((entrada) => `${entrada.tipo}:${entrada.nome}`)).toEqual([
      'pasta:Árvore',
      'pasta:Biologia',
      'nota:Ácido',
      'nota:Zebra',
    ]);
  });

  it('24. nome exibido não inclui caminho nem extensão', () => {
    expect(nomeDaNota('06_Conhecimento/Medicina/Fisiologia respiratória.md')).toBe(
      'Fisiologia respiratória',
    );
  });

  it('25. filtro encontra nome na árvore inteira, fora da pasta aberta', () => {
    const arvore = construirArvore([
      '06_Conhecimento/Pasta aberta/Outra.md',
      '06_Conhecimento/Pasta distante/Nota alvo.md',
    ]);
    expect(filtrarNotas(arvore, 'ALVO')).toMatchObject([
      { nome: 'Nota alvo', pasta: 'Pasta distante' },
    ]);
  });

  it('26. montar e percorrer a árvore não chama a API', () => {
    const fetchOriginal = globalThis.fetch;
    const fetchFalso = vi.fn();
    globalThis.fetch = fetchFalso as unknown as typeof fetch;
    const arvore = construirArvore(['06_Conhecimento/A/B/Nota.md']);
    entradasDaPasta(arvore, 'A');
    filtrarNotas(arvore, 'nota');
    expect(fetchFalso).not.toHaveBeenCalled();
    globalThis.fetch = fetchOriginal;
  });

  it('133. pasta pendente existe só na árvore da sessão e vira real com a primeira nota', () => {
    const vazia = construirArvore([], ['Leituras/Livros']);
    expect(vazia.pastas.get('Leituras/Livros')).toMatchObject({ pendente: true, totalNotas: 0 });
    expect(construirArvore([]).pastas.has('Leituras')).toBe(false);
    const criada = construirArvore(['06_Conhecimento/Leituras/Livros/Primeira.md'], ['Leituras/Livros']);
    expect(criada.pastas.get('Leituras/Livros')).toMatchObject({ totalNotas: 1 });
    expect(criada.pastas.get('Leituras/Livros')?.pendente).toBeUndefined();
  });
});
