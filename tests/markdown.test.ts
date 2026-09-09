// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  acaoWikilink,
  recortarSecao,
  renderizarMarkdown,
  resolverWikilink,
} from '../src/markdown';

const caminhos = [
  '06_Conhecimento/Medicina/Atual.md',
  '06_Conhecimento/Medicina/Nota.md',
  '06_Conhecimento/Outra/Nota.md',
];
const atual = '06_Conhecimento/Medicina/Atual.md';

function corpo(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

describe('casos 27–34 · wikilinks', () => {
  it('27. [[Nota]] vira link para o alvo resolvido', () => {
    const raiz = corpo(renderizarMarkdown('[[Nota]]', { caminhos, caminhoAtual: atual }));
    const link = raiz.querySelector<HTMLAnchorElement>('a.nota-link');
    expect(link?.textContent).toBe('Nota');
    expect(link?.dataset.caminho).toBe('06_Conhecimento/Medicina/Nota.md');
  });

  it('28. [[Nota|apelido]] mostra apelido e mantém o alvo', () => {
    const raiz = corpo(renderizarMarkdown('[[Nota|apelido]]', { caminhos, caminhoAtual: atual }));
    const link = raiz.querySelector<HTMLAnchorElement>('a.nota-link');
    expect(link?.textContent).toBe('apelido');
    expect(link?.dataset.caminho).toBe('06_Conhecimento/Medicina/Nota.md');
  });

  it('29. [[Nota#Seção]] leva a seção e o recorte acha sua faixa', () => {
    const raiz = corpo(
      renderizarMarkdown('[[Nota#Seção]]', { caminhos, caminhoAtual: atual }),
    );
    expect(raiz.querySelector<HTMLAnchorElement>('a')?.dataset.secao).toBe('Seção');
    expect(recortarSecao('# Antes\nA\n## Seção\nB\n### Dentro\nC\n## Depois\nD', 'seção')).toBe(
      '## Seção\nB\n### Dentro\nC',
    );
  });

  it('30. alvo inexistente fica marcado e sua ação avisa em vez de navegar', () => {
    const raiz = corpo(renderizarMarkdown('[[Ausente]]', { caminhos, caminhoAtual: atual }));
    const link = raiz.querySelector<HTMLAnchorElement>('a');
    expect(link?.classList.contains('nota-link-faltante')).toBe(true);
    expect(link?.dataset.caminho).toBeUndefined();
    expect(acaoWikilink(null, '')).toEqual({ tipo: 'faltante' });
  });

  it('31. entre nomes iguais vence o alvo da mesma pasta', () => {
    expect(resolverWikilink(caminhos, atual, 'Nota')).toBe(
      '06_Conhecimento/Medicina/Nota.md',
    );
  });

  it('32. resolução ignora diferenças entre maiúsculas e minúsculas', () => {
    expect(resolverWikilink(caminhos, atual, 'nOtA')).toBe(
      '06_Conhecimento/Medicina/Nota.md',
    );
  });

  it('33. wikilink dentro de bloco de código não vira link', () => {
    const raiz = corpo(renderizarMarkdown('```md\n[[Nota]]\n```', { caminhos, caminhoAtual: atual }));
    expect(raiz.querySelector('a.nota-link')).toBeNull();
    expect(raiz.querySelector('code')?.textContent).toBe('[[Nota]]\n');
  });

  it('34. embed permanece texto cru e não é interpretado', () => {
    const raiz = corpo(renderizarMarkdown('![[Nota]]', { caminhos, caminhoAtual: atual }));
    expect(raiz.querySelector('a, img')).toBeNull();
    expect(raiz.textContent?.trim()).toBe('![[Nota]]');
    const imagem = corpo(renderizarMarkdown('![anexo](imagens/figura.png)'));
    expect(imagem.querySelector('img')).toBeNull();
    expect(imagem.textContent?.trim()).toBe('![anexo](imagens/figura.png)');
  });
});

describe('casos 38–42 · renderização', () => {
  it('38. quebra simples vira <br> com o texto de entrada intocado', () => {
    const texto = 'linha um\nlinha dois';
    const html = renderizarMarkdown(texto);
    expect(html).toContain('linha um<br>');
    expect(texto).toBe('linha um\nlinha dois');
  });

  it('39. quebra dentro de bloco de código fica no conteúdo, sem <br>', () => {
    const raiz = corpo(renderizarMarkdown('```\nlinha um\nlinha dois\n```'));
    expect(raiz.querySelector('code')?.textContent).toBe('linha um\nlinha dois\n');
    expect(raiz.querySelector('pre')?.innerHTML).not.toContain('<br>');
  });

  it('40. tabela Markdown renderiza como tabela HTML', () => {
    const raiz = corpo(renderizarMarkdown('| A | B |\n|---|---|\n| 1 | 2 |'));
    expect(raiz.querySelectorAll('table')).toHaveLength(1);
    expect(raiz.querySelectorAll('th')).toHaveLength(2);
    expect(raiz.querySelectorAll('td')).toHaveLength(2);
  });

  it('41. tarefas viram caixas desmarcada e marcada, ambas desabilitadas', () => {
    const raiz = corpo(renderizarMarkdown('- [ ] aberta\n- [x] feita'));
    const caixas = [...raiz.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(caixas).toHaveLength(2);
    expect(caixas.map((caixa) => caixa.disabled)).toEqual([true, true]);
    expect(caixas.map((caixa) => caixa.checked)).toEqual([false, true]);
  });

  it('42. HTML é saneado e script não sobrevive', () => {
    const html = renderizarMarkdown('<script>alert("não")</script><p>seguro</p>');
    const raiz = corpo(html);
    expect(raiz.querySelector('script')).toBeNull();
    expect(raiz.textContent).toBe('seguro');
  });
});

describe('casos 52–57 · seções da própria nota', () => {
  it('52. [[#Seção]] navega na nota atual, não para alvo faltante', () => {
    const raiz = corpo(renderizarMarkdown('[[#Seção]]', { caminhos, caminhoAtual: atual }));
    const link = raiz.querySelector<HTMLAnchorElement>('a.nota-link');
    expect(link?.classList.contains('nota-link-existente')).toBe(true);
    expect(link?.dataset.caminho).toBe(atual);
    expect(acaoWikilink(link?.dataset.caminho ?? null, link?.dataset.secao ?? '')).toEqual({
      tipo: 'navegar',
      caminho: atual,
      secao: 'Seção',
    });
  });

  it('53. [[#Seção|apelido]] navega na nota atual e mostra o apelido', () => {
    const raiz = corpo(
      renderizarMarkdown('[[#Seção|atalho]]', { caminhos, caminhoAtual: atual }),
    );
    const link = raiz.querySelector<HTMLAnchorElement>('a.nota-link');
    expect(link?.textContent).toBe('atalho');
    expect(link?.dataset.caminho).toBe(atual);
    expect(link?.dataset.secao).toBe('Seção');
  });

  it('54. [[Nota#Seção]] continua navegando para a outra nota', () => {
    const raiz = corpo(
      renderizarMarkdown('[[Nota#Seção]]', { caminhos, caminhoAtual: atual }),
    );
    const link = raiz.querySelector<HTMLAnchorElement>('a.nota-link');
    expect(link?.dataset.caminho).toBe('06_Conhecimento/Medicina/Nota.md');
    expect(link?.dataset.secao).toBe('Seção');
  });

  it('55. [[]] e [[#]] permanecem texto cru, sem link', () => {
    const raiz = corpo(renderizarMarkdown('[[]]\n[[#]]', { caminhos, caminhoAtual: atual }));
    expect(raiz.querySelector('a')).toBeNull();
    expect(raiz.textContent).toContain('[[]]');
    expect(raiz.textContent).toContain('[[#]]');
  });

  it('56. os 20 primeiros links do índice real de Semiologia resolvem na nota atual', () => {
    const indice = [
      '[[#Revisão sistemática]]',
      '[[#Inspeção|Inspeção]]',
      '[[#Palpação|Palpação]]',
      '[[#Percussão|Percussão]]',
      '[[#Ausculta|Ausculta]]',
      '[[#Sequência completa exame|sequência completa do exame]]',
      '[[#Sintomas principais|Sintomas principais]]',
      '[[#Roteiro de Caracterização de sintomas|Roteiro de Caracterização de sintomas]]',
      '[[#Anamnese dirigida|Anamnese Dirigida]]',
      '[[#Red Flags na anamnese de cabeça e pescoço|Red Flags na anamnese de cabeça e pescoço]]',
      '[[#Semiologia do crânio e Couro Cabeludo|Semiologia do crânio e Couro Cabeludo]]',
      '[[#Semiologia da Face|Semiologia da Face]]',
      '[[#Semiologia Ocular e Estruturas Oculares.|Semiologia Ocular e Estruturas Oculares.]]',
      '[[#Semiologia do Nariz e Seios Paranasais|Semiologia do Nariz e Seios Paranasais]]',
      '[[#Cavidade Oral|Cavidade Oral]]',
      '[[#Glândulas salivares|Glândulas salivares]]',
      '[[#Semiologia do Ouvido|Semiologia do Ouvido]]',
      '[[#Semiologia da ATM|Semiologia da ATM]]',
      '[[#Semiologia da Tireoide|Semiologia da Tireoide]]',
      '[[#Semiologia dos Linfonodos Cervicais e Cadeias Ganglionares|Semiologia dos Linfonodos Cervicais e Cadeias Ganglionares]]',
    ].join('\n');
    const raiz = corpo(renderizarMarkdown(indice, { caminhos, caminhoAtual: atual }));
    const links = [...raiz.querySelectorAll<HTMLAnchorElement>('a.nota-link')];
    expect(links).toHaveLength(20);
    expect(links.every((link) => link.dataset.caminho === atual)).toBe(true);
    expect(links.some((link) => link.classList.contains('nota-link-faltante'))).toBe(false);
  });

  it('57. wikilink não recebe sublinhado em nenhum estado', () => {
    const html = renderizarMarkdown('[[Nota]] [[Ausente]]', { caminhos, caminhoAtual: atual });
    expect(html).not.toContain('text-decoration');
    const css = readFileSync(join(process.cwd(), 'src', 'style.css'), 'utf8');
    expect(css).toMatch(/\.nota-link\s*\{[^}]*text-decoration:\s*none/);
    expect(css).not.toMatch(/\.nota-link[^}]*text-decoration-(?:style|line)/);
  });
});
