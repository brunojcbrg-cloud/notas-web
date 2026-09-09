// @vitest-environment jsdom

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
