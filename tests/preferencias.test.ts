import { describe, expect, it, vi } from 'vitest';
import {
  CAMINHO_PREFERENCIAS,
  analisarPreferencias,
  guardarPreferenciasRemotas,
  lerPreferenciasRemotas,
  serializarPreferencias,
} from '../src/preferencias';
import { codificarBase64 } from '../src/bytes';

function respostaJson(corpoJson: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => corpoJson,
  } as unknown as Response;
}

describe('preferência de tema no vault', () => {
  it('fica fora da pasta de notas, para não virar nota no Obsidian', () => {
    expect(CAMINHO_PREFERENCIAS.startsWith('06_Conhecimento/')).toBe(false);
    expect(CAMINHO_PREFERENCIAS).toBe('05_Sistema/notas-web/preferencias.json');
  });

  it('aceita só tema e modo conhecidos', () => {
    expect(analisarPreferencias('{"tema":"solarized","modo":"dark"}')).toEqual({
      tema: 'solarized',
      modo: 'dark',
    });
    // Valor desconhecido cai no padrão em vez de derrubar a tela.
    expect(analisarPreferencias('{"tema":"neon","modo":"dark"}')).toEqual({
      tema: 'padrao',
      modo: 'dark',
    });
    expect(analisarPreferencias('{"tema":"neon","modo":"fosforescente"}')).toBeNull();
    expect(analisarPreferencias('não é json')).toBeNull();
    expect(analisarPreferencias('null')).toBeNull();
  });

  it('serializa só os dois campos, com quebra final', () => {
    const texto = serializarPreferencias({ tema: 'obsidian', modo: 'light' });
    expect(JSON.parse(texto)).toEqual({ tema: 'obsidian', modo: 'light' });
    expect(texto.endsWith('\n')).toBe(true);
  });

  it('arquivo ainda não criado devolve nulo, não erro', async () => {
    const fetcher = vi.fn(async () => respostaJson({}, 404));
    await expect(lerPreferenciasRemotas('tk', fetcher as never)).resolves.toBeNull();
  });

  it('lê o conteúdo em base64 e devolve o sha', async () => {
    const fetcher = vi.fn(async () =>
      respostaJson({
        content: codificarBase64('{"tema":"solarized","modo":"light"}', false),
        sha: 'abc123',
      }),
    );
    await expect(lerPreferenciasRemotas('tk', fetcher as never)).resolves.toEqual({
      preferencia: { tema: 'solarized', modo: 'light' },
      sha: 'abc123',
    });
  });

  it('grava reusando o sha atual, para não recusar a troca da outra máquina', async () => {
    const chamadas: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      chamadas.push({ url, init });
      if (!init || init.method !== 'PUT') {
        return respostaJson({
          content: codificarBase64('{"tema":"padrao","modo":"system"}', false),
          sha: 'sha-velho',
        });
      }
      return respostaJson({ content: {} });
    });
    await guardarPreferenciasRemotas('tk', { tema: 'obsidian', modo: 'dark' }, fetcher as never);
    const put = chamadas.find((chamada) => chamada.init?.method === 'PUT');
    expect(put).toBeDefined();
    const corpo = JSON.parse(String(put?.init?.body)) as Record<string, string>;
    expect(corpo.sha).toBe('sha-velho');
    expect(corpo.branch).toBe('master');
    expect(corpo.message).toContain(CAMINHO_PREFERENCIAS);
  });

  it('primeira gravação vai sem sha, porque o arquivo não existe', async () => {
    const chamadas: Array<{ init?: RequestInit }> = [];
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      chamadas.push({ init });
      if (!init || init.method !== 'PUT') return respostaJson({}, 404);
      return respostaJson({});
    });
    await guardarPreferenciasRemotas('tk', { tema: 'padrao', modo: 'light' }, fetcher as never);
    const put = chamadas.find((chamada) => chamada.init?.method === 'PUT');
    const corpo = JSON.parse(String(put?.init?.body)) as Record<string, string>;
    expect('sha' in corpo).toBe(false);
  });

  it('falha de permissão vira erro com o status, não silêncio', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) =>
      !init || init.method !== 'PUT' ? respostaJson({}, 404) : respostaJson({}, 403),
    );
    await expect(
      guardarPreferenciasRemotas('tk', { tema: 'padrao', modo: 'dark' }, fetcher as never),
    ).rejects.toThrow('403');
  });
});
