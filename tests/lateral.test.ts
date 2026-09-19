// @vitest-environment jsdom
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CHAVE_LATERAL, criarLateral, lerEstadoLateral, type ArmazenamentoLateral } from '../src/lateral';
import { construirArvore } from '../src/tree';

function storage(valor?: string): ArmazenamentoLateral {
  const itens = new Map<string, string>();
  if (valor !== undefined) itens.set(CHAVE_LATERAL, valor);
  return {
    getItem: (chave) => itens.get(chave) ?? null,
    setItem: (chave, texto) => { itens.set(chave, texto); },
  };
}

function caminhosDoVault(): string[] | null {
  const raiz = 'E:/Obsidian/CONHECIMENTO/06_Conhecimento';
  if (!existsSync(raiz)) return null;
  const caminhos: string[] = [];
  const visitar = (pasta: string): void => {
    for (const entrada of readdirSync(pasta, { withFileTypes: true })) {
      const caminho = join(pasta, entrada.name);
      if (entrada.isDirectory()) visitar(caminho);
      else if (entrada.isFile() && entrada.name.toLowerCase().endsWith('.md')) {
        caminhos.push(`06_Conhecimento/${relative(raiz, caminho).replaceAll('\\', '/')}`);
      }
    }
  };
  visitar(raiz);
  return caminhos;
}

function contarDiretoriosDoVault(): number {
  const raiz = 'E:/Obsidian/CONHECIMENTO/06_Conhecimento';
  if (!existsSync(raiz)) return 0;
  const contar = (pasta: string): number => readdirSync(pasta, { withFileTypes: true })
    .filter((entrada) => entrada.isDirectory())
    .reduce((total, entrada) => total + 1 + contar(join(pasta, entrada.name)), 0);
  return contar(raiz);
}

const amostra = [
  '06_Conhecimento/Medicina/Matérias Básicas/Genética/P3/Uma.md',
  '06_Conhecimento/Medicina/Matérias Básicas/Genética/P3/Duas.md',
  "06_Conhecimento/Hipótese de ''Dois eventos/Primeira.md",
  '06_Conhecimento/Hipótese de Dois eventos/Segunda.md',
];

describe('casos 101–118 · coluna lateral', () => {
  it('101. renderiza cada caminho real uma vez quando o vault está disponível', () => {
    const caminhos = caminhosDoVault() ?? [
      ...Array.from({ length: 28 }, (_, i) => `06_Conhecimento/Pasta ${i}/Nota.md`),
      ...Array.from({ length: 111 }, (_, i) => `06_Conhecimento/Nota ${i}.md`),
    ];
    const arvore = construirArvore(caminhos);
    const lateral = criarLateral(arvore, storage(), vi.fn(), vi.fn());
    if (existsSync('E:/Obsidian/CONHECIMENTO/06_Conhecimento')) {
      expect(contarDiretoriosDoVault()).toBe(62);
    }
    expect(arvore.totalPastas).toBe(28);
    expect(arvore.notas).toHaveLength(139);
    expect(lateral.elemento.querySelectorAll('.lateral-pasta')).toHaveLength(28);
    expect(lateral.elemento.querySelectorAll('.lateral-nota')).toHaveLength(139);
    const vistos = [...lateral.elemento.querySelectorAll<HTMLButtonElement>('.lateral-nota')]
      .map((botao) => botao.dataset.caminho);
    expect(new Set(vistos).size).toBe(139);
  });

  it('102. distingue as pastas irmãs de Hipótese pelo caminho completo', () => {
    const lateral = criarLateral(construirArvore(amostra), storage(), vi.fn(), vi.fn());
    const botoes = lateral.elemento.querySelectorAll<HTMLButtonElement>('.lateral-pasta');
    expect([...botoes].filter((botao) => botao.title.startsWith('Hipótese'))).toHaveLength(2);
    const primeira = lateral.elemento.querySelector<HTMLButtonElement>(`[data-caminho="Hipótese de ''Dois eventos"]`)!;
    const segunda = lateral.elemento.querySelector<HTMLButtonElement>('[data-caminho="Hipótese de Dois eventos"]')!;
    primeira.click();
    expect(primeira.getAttribute('aria-expanded')).toBe('true');
    expect(segunda.getAttribute('aria-expanded')).toBe('false');
    expect(primeira.nextElementSibling?.textContent).toContain('Primeira');
    expect(segunda.nextElementSibling?.textContent).toContain('Segunda');
  });

  it('103. alternar uma pasta mantém irmãs e persiste o Set por caminho', () => {
    const memoria = storage();
    const lateral = criarLateral(construirArvore(amostra), memoria, vi.fn(), vi.fn());
    const genetica = lateral.elemento.querySelector<HTMLButtonElement>('[data-caminho="Medicina/Matérias Básicas/Genética"]')!;
    const hipotese = lateral.elemento.querySelector<HTMLButtonElement>('[data-caminho="Hipótese de Dois eventos"]')!;
    genetica.click();
    expect(genetica.getAttribute('aria-expanded')).toBe('true');
    expect(hipotese.getAttribute('aria-expanded')).toBe('false');
    expect(JSON.parse(memoria.getItem(CHAVE_LATERAL)!).expandidas).toEqual(['Medicina/Matérias Básicas/Genética']);
    genetica.click();
    expect(genetica.getAttribute('aria-expanded')).toBe('false');
  });

  it('107–108. nota selecionada destaca e abre todos os ancestrais', () => {
    const memoria = storage();
    const lateral = criarLateral(construirArvore(amostra), memoria, vi.fn(), vi.fn());
    lateral.selecionarNota('06_Conhecimento/Medicina/Matérias Básicas/Genética/P3/Uma.md');
    const ativa = lateral.elemento.querySelector<HTMLButtonElement>('.lateral-nota.ativa')!;
    expect(ativa.getAttribute('aria-current')).toBe('page');
    expect(ativa.textContent).toContain('Uma');
    for (const caminho of ['Medicina', 'Medicina/Matérias Básicas', 'Medicina/Matérias Básicas/Genética', 'Medicina/Matérias Básicas/Genética/P3']) {
      expect(lateral.elemento.querySelector(`[data-caminho="${caminho}"]`)?.getAttribute('aria-expanded')).toBe('true');
    }
  });

  it('109–110. estado inválido cai no padrão e caminhos removidos são descartados', () => {
    const arvore = construirArvore(amostra);
    expect(lerEstadoLateral(storage('{inválido'), arvore, false)).toEqual({ aberta: false, expandidas: [] });
    expect(lerEstadoLateral(storage(), arvore)).toEqual({ aberta: true, expandidas: [] });
    expect(lerEstadoLateral(storage(JSON.stringify({ aberta: false, expandidas: ['Inexistente', 'Medicina', 'Medicina'] })), arvore))
      .toEqual({ aberta: false, expandidas: ['Medicina'] });
    const memoria = storage(JSON.stringify({ aberta: false, expandidas: ['Medicina', 'Inexistente'] }));
    const lateral = criarLateral(construirArvore([]), memoria, vi.fn(), vi.fn());
    lateral.atualizarArvore(arvore);
    expect(lateral.elemento.querySelector('[data-caminho="Medicina"]')?.getAttribute('aria-expanded')).toBe('true');
    expect(JSON.parse(memoria.getItem(CHAVE_LATERAL)!).expandidas).toEqual(['Medicina']);
  });

  it('114 e 118. nome inteiro fica no title; botões expõem estado para teclado', () => {
    const nome = 'N'.repeat(75);
    const lateral = criarLateral(construirArvore([`06_Conhecimento/Pasta/${nome}.md`]), storage(), vi.fn(), vi.fn());
    const nota = lateral.elemento.querySelector<HTMLButtonElement>('.lateral-nota')!;
    const pasta = lateral.elemento.querySelector<HTMLButtonElement>('.lateral-pasta')!;
    expect(nota.title).toBe(nome);
    expect(nota.tabIndex).toBe(0);
    expect(pasta.getAttribute('aria-expanded')).toBe('false');
    pasta.click();
    expect(pasta.getAttribute('aria-expanded')).toBe('true');
    expect(readFileSync('src/style.css', 'utf8')).toMatch(/\.lateral-nome\s*\{[^}]*text-overflow: ellipsis/s);
  });
});
