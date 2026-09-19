import { describe, expect, it, vi } from 'vitest';
import { CaminhoExistente, ConflitoGitHub, listarNotasComSha } from '../src/github';
import { analisarRenomeacao, mover, planejarMovimento, planejarRenomeacao, renomear } from '../src/operacoes';

const P = '06_Conhecimento/';

function resposta(dados: unknown, status = 200): Response {
  return new Response(JSON.stringify(dados), { status, headers: { 'Content-Type': 'application/json' } });
}

function apiFalsa(falharPatch = false): typeof fetch {
  const fila = [
    resposta({ object: { sha: 'commit-antigo' } }),
    resposta({ tree: { sha: 'tree-antiga' } }),
    resposta({ sha: 'tree-nova' }),
    resposta({ sha: 'commit-novo' }),
    resposta(falharPatch ? { message: 'branch moved' } : {}, falharPatch ? 422 : 200),
  ];
  return vi.fn(async () => fila.shift() as Response) as unknown as typeof fetch;
}

describe('handoff 07 · fatia 1, somente Fetcher injetado', () => {
  it('121. mover nota faz cinco chamadas e um commit, com o mesmo SHA do blob', async () => {
    const antigo = `${P}A/Nota.md`;
    const novo = `${P}B/Nota.md`;
    const mock = apiFalsa();
    const resultado = await mover('token-falso', { tipo: 'nota', caminho: antigo }, 'B', new Map([[antigo, 'blob-original']]), 'tree-antiga', mock);
    expect(resultado.caminhos.get(antigo)).toBe(novo);
    expect(resultado.treeSha).toBe('tree-nova');
    expect(mock).toHaveBeenCalledTimes(5);
    const chamadas = vi.mocked(mock).mock.calls;
    expect(chamadas.map(([url, init]) => `${init?.method} ${String(url).split('/git/')[1]}`)).toEqual([
      'GET ref/heads/master', 'GET commits/commit-antigo', 'POST trees',
      'POST commits', 'PATCH refs/heads/master',
    ]);
    expect(JSON.parse(String(chamadas[2]?.[1]?.body))).toEqual({
      base_tree: 'tree-antiga',
      tree: [
        { path: antigo, mode: '100644', type: 'blob', sha: null },
        { path: novo, mode: '100644', type: 'blob', sha: 'blob-original' },
      ],
    });
    expect(JSON.parse(String(chamadas[3]?.[1]?.body))).toEqual({
      message: `notas-web: mover ${antigo} → ${novo}`,
      tree: 'tree-nova', parents: ['commit-antigo'],
    });
    expect(JSON.parse(String(chamadas[4]?.[1]?.body))).toEqual({ sha: 'commit-novo' });
    expect(String(chamadas[2]?.[1]?.body)).not.toContain('content');
  });

  it('124. destino ocupado recusa sem chamada', async () => {
    const antigo = `${P}A/Nota.md`;
    const mock = apiFalsa();
    await expect(mover('x', { tipo: 'nota', caminho: antigo }, 'B', new Map([
      [antigo, 'sha-1'], [`${P}B/Nota.md`, 'sha-2'],
    ]), 'tree-antiga', mock)).rejects.toBeInstanceOf(CaminhoExistente);
    expect(mock).not.toHaveBeenCalled();
  });

  it('125. pasta de 77 notas mantém todos os blobs em cinco chamadas e um commit', async () => {
    const blobs = new Map(Array.from({ length: 77 }, (_, i) => [
      `${P}Genética/P3/Nota ${i}.md`, `blob-${i}`,
    ]));
    const mock = apiFalsa();
    const resultado = await mover('x', { tipo: 'pasta', caminho: 'Genética/P3' }, 'Outra', blobs, 'tree-antiga', mock);
    expect(resultado.caminhos.size).toBe(77);
    expect(mock).toHaveBeenCalledTimes(5);
    const corpo = JSON.parse(String(vi.mocked(mock).mock.calls[2]?.[1]?.body));
    expect(corpo.tree).toHaveLength(154);
    for (let i = 0; i < 77; i += 1) {
      expect(corpo.tree).toContainEqual({
        path: `${P}Outra/P3/Nota ${i}.md`, mode: '100644', type: 'blob', sha: `blob-${i}`,
      });
    }
    expect(vi.mocked(mock).mock.calls.filter(([, init]) => init?.method === 'POST' && String(init.body).includes('parents'))).toHaveLength(1);
  });

  it('126. pasta não entra nela mesma antes de chamar a API', async () => {
    const mock = apiFalsa();
    await expect(mover('x', { tipo: 'pasta', caminho: 'Genética' }, 'Genética/P3', new Map([[`${P}Genética/P3/A.md`, 'sha']]), 'tree-antiga', mock)).rejects.toThrow('dentro de si');
    expect(mock).not.toHaveBeenCalled();
  });

  it('127. avanço do ramo rejeita PATCH sem force e não repete', async () => {
    const mock = apiFalsa(true);
    await expect(mover('x', { tipo: 'nota', caminho: `${P}A.md` }, 'B', new Map([[`${P}A.md`, 'sha']]), 'tree-antiga', mock)).rejects.toBeInstanceOf(ConflitoGitHub);
    expect(mock).toHaveBeenCalledTimes(5);
    expect(JSON.parse(String(vi.mocked(mock).mock.calls[4]?.[1]?.body))).not.toHaveProperty('force');
  });

  it('136. caminhos fora da pasta, com .. ou barra invertida são recusados', () => {
    const blobs = new Map([[`${P}A.md`, 'sha']]);
    for (const destino of ['../fora', 'B\\C', '/fora']) {
      expect(() => planejarMovimento({ tipo: 'nota', caminho: `${P}A.md` }, destino, blobs)).toThrow();
    }
    expect(() => planejarMovimento({ tipo: 'nota', caminho: '05_Sistema/A.md' }, '', blobs)).toThrow();
  });

  it('§1.1. lista preserva SHA de cada blob ao lado dos caminhos', async () => {
    const mock = vi.fn(async () => resposta({ sha: 'tree-1', tree: [
      { path: `${P}A.md`, type: 'blob', sha: 'blob-a' },
      { path: `${P}B.md`, type: 'blob', sha: 'blob-b' },
    ] })) as unknown as typeof fetch;
    const lista = await listarNotasComSha('x', mock);
    expect(lista.caminhos).toEqual([`${P}A.md`, `${P}B.md`]);
    expect([...lista.blobs]).toEqual([[`${P}A.md`, 'blob-a'], [`${P}B.md`, 'blob-b']]);
    expect(lista.treeSha).toBe('tree-1');
    expect(mock).toHaveBeenCalledTimes(1);
  });
});

describe('handoff 07 · fatia 2, renomear e wikilinks', () => {
  const alvo = `${P}A/Antiga.md`;
  const origemLinks = `${P}B/Referências.md`;

  function mockRenomear(conteudos: Map<string, string>): typeof fetch {
    let blobNovo = 0;
    return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const endereco = String(url);
      const metodo = init?.method ?? 'GET';
      if (endereco.includes('/git/blobs/') && metodo === 'GET') {
        const sha = endereco.split('/').at(-1) as string;
        return resposta({ content: Buffer.from(conteudos.get(sha) as string, 'utf8').toString('base64') });
      }
      if (endereco.endsWith('/git/blobs') && metodo === 'POST') return resposta({ sha: `blob-novo-${++blobNovo}` });
      if (endereco.includes('/git/ref/heads/') && metodo === 'GET') return resposta({ object: { sha: 'commit-antigo' } });
      if (endereco.includes('/git/commits/') && metodo === 'GET') return resposta({ tree: { sha: 'tree-antiga' } });
      if (endereco.endsWith('/git/trees') && metodo === 'POST') return resposta({ sha: 'tree-nova' });
      if (endereco.endsWith('/git/commits') && metodo === 'POST') return resposta({ sha: 'commit-novo' });
      if (endereco.includes('/git/refs/heads/') && metodo === 'PATCH') return resposta({});
      return resposta({}, 404);
    }) as unknown as typeof fetch;
  }

  it('128. reescreve 169 links em um commit e preserva BOM, CRLF e fim de arquivo', async () => {
    const blobs = new Map([[alvo, 'sha-alvo'], [origemLinks, 'sha-links']]);
    const texto = `\uFEFF# Referências\r\n${'[[Antiga#Seção|apelido]]\r\n'.repeat(169)}fim`;
    const mock = mockRenomear(new Map([['sha-alvo', '# Antiga\n'], ['sha-links', texto]]));
    const plano = await analisarRenomeacao('x', { tipo: 'nota', caminho: alvo }, 'Nova', blobs, mock);
    expect(plano.reescritos).toBe(169);
    expect(plano.ignorados).toBe(0);
    expect(plano.reescritas[0].texto).toBe(texto.slice(1).replaceAll('[[Antiga', '[[Nova'));
    const resultado = await renomear('x', { tipo: 'nota', caminho: alvo }, plano, blobs, 'tree-antiga', mock);
    expect(resultado.caminhos.get(alvo)).toBe(`${P}A/Nova.md`);
    const chamadas = vi.mocked(mock).mock.calls;
    const criacoes = chamadas.filter(([url, init]) => String(url).endsWith('/git/blobs') && init?.method === 'POST');
    expect(criacoes).toHaveLength(1);
    expect(Buffer.from(JSON.parse(String(criacoes[0][1]?.body)).content, 'base64').toString()).toBe(texto.replaceAll('[[Antiga', '[[Nova'));
    expect(chamadas.filter(([url, init]) => String(url).endsWith('/git/commits') && init?.method === 'POST')).toHaveLength(1);
    expect(JSON.parse(String(chamadas.at(-1)?.[1]?.body))).toEqual({ sha: 'commit-novo' });
  });

  it('129 e 131. links ambíguos e CR isolado ficam fora da reescrita e são contados', async () => {
    const ambiguos = new Map([[alvo, 'sha-alvo'], [`${P}C/Antiga.md`, 'sha-homonimo'], [origemLinks, 'sha-links']]);
    const mockAmbiguo = mockRenomear(new Map([['sha-alvo', ''], ['sha-homonimo', ''], ['sha-links', '[[Antiga]] [[Antiga]]']]));
    const planoAmbiguo = await analisarRenomeacao('x', { tipo: 'nota', caminho: alvo }, 'Nova', ambiguos, mockAmbiguo);
    expect([planoAmbiguo.reescritos, planoAmbiguo.ignorados]).toEqual([0, 2]);
    const simples = new Map([[alvo, 'sha-alvo'], [origemLinks, 'sha-links']]);
    const mockCr = mockRenomear(new Map([['sha-alvo', ''], ['sha-links', 'linha\r[[Antiga]]']]));
    const planoCr = await analisarRenomeacao('x', { tipo: 'nota', caminho: alvo }, 'Nova', simples, mockCr);
    expect([planoCr.reescritos, planoCr.ignorados, planoCr.reescritas.length]).toEqual([0, 1, 0]);
  });

  it('130. só trocar maiúscula é renomeação real; destino ocupado e caminhos inválidos são recusados', () => {
    const blobs = new Map([[alvo, 'sha-alvo']]);
    expect(planejarRenomeacao({ tipo: 'nota', caminho: alvo }, 'ANTIGA', blobs).get(alvo)).toBe(`${P}A/ANTIGA.md`);
    expect(() => planejarRenomeacao({ tipo: 'nota', caminho: alvo }, '../fora', blobs)).toThrow();
    expect(() => planejarRenomeacao({ tipo: 'nota', caminho: alvo }, 'B\\C', blobs)).toThrow();
    expect(() => planejarRenomeacao({ tipo: 'nota', caminho: alvo }, 'Usada', new Map([...blobs, [`${P}A/Usada.md`, 'sha-2']]))).toThrow(CaminhoExistente);
  });
});
