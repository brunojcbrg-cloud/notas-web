// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  acaoWikilink,
  acharEmbeds,
  acharWikilinks,
  listarCabecalhos,
  posicaoDaSecao,
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

  it('34. embed de nota permanece texto cru e não é interpretado', () => {
    const raiz = corpo(renderizarMarkdown('![[Nota]]', { caminhos, caminhoAtual: atual }));
    expect(raiz.querySelector('a, img')).toBeNull();
    expect(raiz.textContent?.trim()).toBe('![[Nota]]');
  });

  // Mudou na Fase I: embed de IMAGEM passou a renderizar. O caso 34 valia para
  // embed de nota, que continua texto cru; imagem tem contrato próprio, em
  // tests/anexos.test.ts. Imagem remota continua fora, por decisão do Bruno.
  it('34b. embed de imagem local renderiza; remota continua texto', () => {
    const local = corpo(renderizarMarkdown('![anexo](imagens/figura.png)'));
    expect(local.querySelector('img')?.dataset.anexo).toBe('imagens/figura.png');
    expect(local.querySelector('img')?.getAttribute('src')).toBeNull();
    const remota = corpo(renderizarMarkdown('![anexo](https://exemplo.com/figura.png)'));
    expect(remota.querySelector('img')).toBeNull();
    expect(remota.textContent?.trim()).toBe('![anexo](https://exemplo.com/figura.png)');
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
  it('extrai uma única lista de cabeçalhos com nível e posição exata em EOL misto', () => {
    const texto = '# Um\r\ncorpo\n## Dois\r### Três';
    expect(listarCabecalhos(texto)).toEqual([
      { titulo: 'Um', nivel: 1, posicao: 0, linha: 0 },
      { titulo: 'Dois', nivel: 2, posicao: 12, linha: 2 },
      { titulo: 'Três', nivel: 3, posicao: 20, linha: 3 },
    ]);
    expect(posicaoDaSecao(texto, 'Três')).toBe(20);
  });

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

describe('wikilink no modo ao vivo · igualdade com o modo leitura', () => {
  it('acha o wikilink simples e aponta o texto visível', () => {
    const achados = acharWikilinks('veja [[Nota]] aqui');
    expect(achados).toHaveLength(1);
    expect(achados[0].de).toBe(5);
    expect(achados[0].ate).toBe(13);
    expect('veja [[Nota]] aqui'.slice(achados[0].deTexto, achados[0].ateTexto)).toBe('Nota');
    expect(achados[0].alvo.alvo).toBe('Nota');
  });

  it('com apelido, o visível é o apelido', () => {
    const texto = '[[Nota|outro nome]]';
    const [achado] = acharWikilinks(texto);
    expect(texto.slice(achado.deTexto, achado.ateTexto)).toBe('outro nome');
    expect(achado.alvo.alvo).toBe('Nota');
  });

  it('wikilink de seção mantém o sustenido à vista e não tem alvo', () => {
    const texto = '[[#Esporos]]';
    const [achado] = acharWikilinks(texto);
    expect(texto.slice(achado.deTexto, achado.ateTexto)).toBe('#Esporos');
    expect(achado.alvo.alvo).toBe('');
    expect(achado.alvo.secao).toBe('Esporos');
  });

  it('espaço em volta do apelido não entra no visível', () => {
    const texto = '[[Nota|  com folga  ]]';
    const [achado] = acharWikilinks(texto);
    expect(texto.slice(achado.deTexto, achado.ateTexto)).toBe('com folga');
  });

  it('embed de imagem não é wikilink de texto', () => {
    expect(acharWikilinks('![[foto.png]]')).toHaveLength(0);
    expect(acharWikilinks('![[foto.png|496]]')).toHaveLength(0);
  });

  it('dois na mesma linha, com as posições certas', () => {
    const texto = '[[Um]] e [[Dois]]';
    const achados = acharWikilinks(texto);
    expect(achados.map((a) => texto.slice(a.deTexto, a.ateTexto))).toEqual(['Um', 'Dois']);
    expect(achados[1].de).toBe(9);
  });

  it('colchete solto ou vazio não vira wikilink', () => {
    expect(acharWikilinks('[[sem fechamento')).toHaveLength(0);
    expect(acharWikilinks('[[]]')).toHaveLength(0);
    expect(acharWikilinks('[[   ]]')).toHaveLength(0);
    expect(acharWikilinks('[[a[b]]')).toHaveLength(0);
  });

  it('o deslocamento base entra nas posições', () => {
    const [achado] = acharWikilinks('[[Nota]]', 100);
    expect(achado.de).toBe(100);
    expect(achado.ate).toBe(108);
    expect(achado.deTexto).toBe(102);
  });

  it('a seção é achada pela posição no texto, para o editor rolar até ela', () => {
    const nota = 'intro\n\n# Um\ncorpo\n\n## Esporos\nfim';
    expect(posicaoDaSecao(nota, 'Esporos')).toBe(nota.indexOf('## Esporos'));
    expect(posicaoDaSecao(nota, 'esporos')).toBe(nota.indexOf('## Esporos'));
    expect(posicaoDaSecao(nota, 'Um')).toBe(nota.indexOf('# Um'));
    expect(posicaoDaSecao(nota, 'nao existe')).toBeNull();
    expect(posicaoDaSecao(nota, '')).toBeNull();
  });
});

describe('varredura de embeds, a que o modo ao vivo usa', () => {
  it('acha o embed com as pontas certas, e ignora o wikilink comum', () => {
    const linha = 'texto ![[foto.png]] e [[Outra nota]] fim';
    const achados = acharEmbeds(linha);
    expect(achados).toHaveLength(1);
    expect(linha.slice(achados[0].de, achados[0].ate)).toBe('![[foto.png]]');
    expect(achados[0].alvo.alvo).toBe('foto.png');
  });

  it('acha o embed colado no fim da frase, que é como ele foi gravado', () => {
    // Exatamente o caso da nota de neuroanatomia: sem espaço antes do `!`.
    const linha = '- mais refinada a resposta final.![[Pasted image 20260921102205.png]]';
    const achados = acharEmbeds(linha);
    expect(achados).toHaveLength(1);
    expect(achados[0].alvo.alvo).toBe('Pasted image 20260921102205.png');
  });

  it('separa alvo e rótulo de largura', () => {
    const achados = acharEmbeds('![[foto.png|496]]');
    expect(achados[0].alvo.alvo).toBe('foto.png');
    expect(achados[0].alvo.texto).toBe('496');
  });

  it('acha mais de um na mesma linha, sem se perder', () => {
    const linha = '![[a.png]]![[b.png]]';
    const achados = acharEmbeds(linha);
    expect(achados.map((achado) => achado.alvo.alvo)).toEqual(['a.png', 'b.png']);
    expect(linha.slice(achados[1].de, achados[1].ate)).toBe('![[b.png]]');
  });

  it('a base desloca as posições para o documento inteiro', () => {
    const achados = acharEmbeds('![[a.png]]', 40);
    expect(achados[0].de).toBe(40);
    expect(achados[0].ate).toBe(50);
  });

  it('recusa o que não fecha, o vazio e o que tem colchete dentro', () => {
    expect(acharEmbeds('![[sem fim')).toHaveLength(0);
    expect(acharEmbeds('![[ ]]')).toHaveLength(0);
    expect(acharEmbeds('![[a[b]]')).toHaveLength(0);
  });
});
