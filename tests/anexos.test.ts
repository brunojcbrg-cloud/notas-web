// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import {
  carregarAnexo,
  ehImagem,
  hidratarImagens,
  limparCacheDeAnexos,
  listarAnexos,
  nomeDoArquivo,
  PASTA_ANEXOS,
  resolverAnexo,
  tipoDaImagem,
} from '../src/anexos';
import { larguraDoRotulo, renderizarMarkdown } from '../src/markdown';

const anexos = [
  `${PASTA_ANEXOS}Screenshot 2026-07-05 133019.png`,
  `${PASTA_ANEXOS}Pasted image 20260623205656.png`,
  `${PASTA_ANEXOS}hipotálamo.jpg`,
];

function corpo(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

function respostaJson(corpoJson: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => corpoJson,
  } as unknown as Response;
}

describe('tipo e nome do anexo', () => {
  it('reconhece as extensões que o vault usa', () => {
    expect(tipoDaImagem('a.png')).toBe('image/png');
    expect(tipoDaImagem('a.JPG')).toBe('image/jpeg');
    expect(tipoDaImagem('a.svg')).toBe('image/svg+xml');
    expect(tipoDaImagem('nota.md')).toBeNull();
    expect(ehImagem('Pasted image 1.PNG')).toBe(true);
    expect(ehImagem('Pasted image 1')).toBe(false);
  });

  it('extrai o nome com barra normal ou invertida', () => {
    expect(nomeDoArquivo('a/b/c.png')).toBe('c.png');
    expect(nomeDoArquivo('a\\b\\c.png')).toBe('c.png');
    expect(nomeDoArquivo('c.png')).toBe('c.png');
  });
});

describe('resolução do anexo', () => {
  it('acha pelo nome curto, como o Obsidian faz', () => {
    expect(resolverAnexo(anexos, 'Screenshot 2026-07-05 133019.png')).toBe(anexos[0]);
  });

  it('aceita o caminho completo já escrito na nota', () => {
    expect(resolverAnexo(anexos, anexos[1])).toBe(anexos[1]);
  });

  it('ignora caixa e acento na comparação do nome', () => {
    expect(resolverAnexo(anexos, 'HIPOTÁLAMO.JPG')).toBe(anexos[2]);
  });

  it('prefere a pasta de anexos quando o nome existe em dois lugares', () => {
    const comSosia = ['06_Conhecimento/Medicina/hipotálamo.jpg', ...anexos];
    expect(resolverAnexo(comSosia, 'hipotálamo.jpg')).toBe(anexos[2]);
  });

  it('devolve nulo quando não existe', () => {
    expect(resolverAnexo(anexos, 'inexistente.png')).toBeNull();
  });
});

describe('markdown de imagem', () => {
  it('embed de imagem vira <img> sem src e com o nome no data-anexo', () => {
    const host = corpo(renderizarMarkdown('![[Pasted image 20260623205656.png]]'));
    const img = host.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBeNull();
    expect(img?.dataset.anexo).toBe('Pasted image 20260623205656.png');
  });

  it('a largura do Obsidian vira atributo width', () => {
    const host = corpo(renderizarMarkdown('![[foto.png|496]]'));
    expect(host.querySelector('img')?.getAttribute('width')).toBe('496');
    const comAltura = corpo(renderizarMarkdown('![[foto.png|800x600]]'));
    expect(comAltura.querySelector('img')?.getAttribute('width')).toBe('800');
  });

  it('apelido que não é número continua sendo o texto alternativo', () => {
    const host = corpo(renderizarMarkdown('![[foto.png|corte sagital]]'));
    const img = host.querySelector('img');
    expect(img?.getAttribute('alt')).toBe('corte sagital');
    expect(img?.hasAttribute('width')).toBe(false);
  });

  it('largura só aceita número inteiro plausível', () => {
    expect(larguraDoRotulo('496')).toBe(496);
    expect(larguraDoRotulo('800x600')).toBe(800);
    expect(larguraDoRotulo('')).toBeNull();
    expect(larguraDoRotulo('-4')).toBeNull();
    expect(larguraDoRotulo('legenda')).toBeNull();
  });

  it('imagem remota continua como texto, e não vaza o IP do leitor', () => {
    const host = corpo(renderizarMarkdown('![alt](https://exemplo.com/a.png)'));
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('![alt](https://exemplo.com/a.png)');
  });

  it('link markdown local também renderiza', () => {
    const host = corpo(renderizarMarkdown('![corte](06_Conhecimento/_anexos/foto.png)'));
    expect(host.querySelector('img')?.dataset.anexo).toBe('06_Conhecimento/_anexos/foto.png');
  });

  it('embed que não é imagem continua como estava', () => {
    const host = corpo(renderizarMarkdown('![[Outra nota]]'));
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('![[Outra nota]]');
  });
});

describe('carregamento pela API', () => {
  it('lista só as imagens da pasta de anexos', async () => {
    const fetcher = vi.fn(async () =>
      respostaJson([
        { type: 'file', path: `${PASTA_ANEXOS}a.png` },
        { type: 'file', path: `${PASTA_ANEXOS}leiame.md` },
        { type: 'dir', path: `${PASTA_ANEXOS}sub` },
      ]),
    );
    await expect(listarAnexos('tk', fetcher as unknown as typeof fetch)).resolves.toEqual([
      `${PASTA_ANEXOS}a.png`,
    ]);
  });

  it('pasta ainda não criada não é erro', async () => {
    const fetcher = vi.fn(async () => respostaJson({}, 404));
    await expect(listarAnexos('tk', fetcher as unknown as typeof fetch)).resolves.toEqual([]);
  });

  it('monta data URL com o tipo da extensão e reaproveita o cache', async () => {
    limparCacheDeAnexos();
    const fetcher = vi.fn(async () => respostaJson({ content: 'QUJD\n', encoding: 'base64' }));
    const caminho = `${PASTA_ANEXOS}a.png`;
    const url = await carregarAnexo('tk', caminho, fetcher as unknown as typeof fetch);
    expect(url).toBe('data:image/png;base64,QUJD');
    await carregarAnexo('tk', caminho, fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('o token vai no cabeçalho, não na URL', async () => {
    limparCacheDeAnexos();
    const fetcher = vi.fn(async () => respostaJson({ content: 'QUJD', encoding: 'base64' }));
    await carregarAnexo('segredo', `${PASTA_ANEXOS}b.png`, fetcher as unknown as typeof fetch);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain('segredo');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer segredo');
  });
});

describe('hidratação depois da sanitização', () => {
  it('preenche o src das imagens resolvidas', async () => {
    limparCacheDeAnexos();
    const host = corpo(renderizarMarkdown('![[Screenshot 2026-07-05 133019.png]]'));
    const fetcher = vi.fn(async () => respostaJson({ content: 'QUJD', encoding: 'base64' }));
    await hidratarImagens(host, 'tk', anexos, fetcher as unknown as typeof fetch);
    expect(host.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,QUJD');
  });

  it('marca a imagem que não existe em vez de deixar quebrada em silêncio', async () => {
    limparCacheDeAnexos();
    const host = corpo(renderizarMarkdown('![[sumiu.png]]'));
    const fetcher = vi.fn(async () => respostaJson({}, 500));
    await hidratarImagens(host, 'tk', anexos, fetcher as unknown as typeof fetch);
    const img = host.querySelector('img');
    expect(img?.classList.contains('nota-imagem-faltante')).toBe(true);
    expect(img?.getAttribute('src')).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
