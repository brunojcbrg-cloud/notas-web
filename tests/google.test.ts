// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErroLoginGoogle, googleDisponivel, localizarESolicitarPasse, solicitarTokenGoogle } from '../src/google';

function resposta(dados: unknown, status = 200): Response {
  return new Response(typeof dados === 'string' ? dados : JSON.stringify(dados), { status });
}

describe('Fase 3, §3.3 · login Google', () => {
  afterEach(() => {
    delete window.google;
  });

  it('googleDisponivel() é falso antes do script accounts.google.com/gsi/client carregar', () => {
    expect(googleDisponivel()).toBe(false);
  });

  it('solicitarTokenGoogle rejeita com ErroLoginGoogle quando a biblioteca não carregou', async () => {
    await expect(solicitarTokenGoogle()).rejects.toBeInstanceOf(ErroLoginGoogle);
  });

  it('solicitarTokenGoogle resolve com o access_token quando o consentimento devolve drive.readonly', async () => {
    const requestAccessToken = vi.fn();
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: (opcoes) => {
            queueMicrotask(() =>
              opcoes.callback({ access_token: 'ya29.token-de-teste', scope: 'openid email https://www.googleapis.com/auth/drive.readonly' }),
            );
            return { requestAccessToken };
          },
        },
      },
    };
    await expect(solicitarTokenGoogle()).resolves.toBe('ya29.token-de-teste');
    expect(requestAccessToken).toHaveBeenCalledOnce();
  });

  it('solicitarTokenGoogle rejeita quando o token volta sem drive.readonly (armadilha medida no M0.3)', async () => {
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: (opcoes) => {
            queueMicrotask(() => opcoes.callback({ access_token: 'ya29.sem-drive', scope: 'openid email' }));
            return { requestAccessToken: vi.fn() };
          },
        },
      },
    };
    await expect(solicitarTokenGoogle()).rejects.toBeInstanceOf(ErroLoginGoogle);
  });

  it('solicitarTokenGoogle rejeita quando o consentimento é cancelado', async () => {
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: (opcoes) => {
            queueMicrotask(() => opcoes.callback({ error: 'access_denied' }));
            return { requestAccessToken: vi.fn() };
          },
        },
      },
    };
    await expect(solicitarTokenGoogle()).rejects.toBeInstanceOf(ErroLoginGoogle);
  });
});

describe('Fase 3, §3.3 · localizar o passe.json no Drive', () => {
  it('acha um único passe.json e devolve o JSON bruto', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(resposta({ files: [{ id: 'file-123', name: 'passe.json' }] }))
      .mockResolvedValueOnce(resposta({ versao: 1, usuario: 'bela.nandes02@gmail.com' })) as unknown as typeof fetch;
    const passe = await localizarESolicitarPasse('token-de-acesso', mock);
    expect(passe).toEqual({ versao: 1, usuario: 'bela.nandes02@gmail.com' });
    const [urlBusca, initBusca] = vi.mocked(mock).mock.calls[0];
    expect(String(urlBusca)).toContain("name%3D'passe.json'");
    expect((initBusca?.headers as Record<string, string>).Authorization).toBe('Bearer token-de-acesso');
    const [urlMedia] = vi.mocked(mock).mock.calls[1];
    expect(String(urlMedia)).toBe('https://www.googleapis.com/drive/v3/files/file-123?alt=media');
  });

  it('sem nenhum passe.json compartilhado, recusa com mensagem clara (não trata como sucesso vazio)', async () => {
    const mock = vi.fn().mockResolvedValueOnce(resposta({ files: [] })) as unknown as typeof fetch;
    await expect(localizarESolicitarPasse('token', mock)).rejects.toBeInstanceOf(ErroLoginGoogle);
  });

  it('mais de um passe.json visível recusa em vez de escolher um a esmo', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(resposta({ files: [{ id: 'a', name: 'passe.json' }, { id: 'b', name: 'passe.json' }] })) as unknown as typeof fetch;
    await expect(localizarESolicitarPasse('token', mock)).rejects.toBeInstanceOf(ErroLoginGoogle);
  });

  it('busca com HTTP de erro recusa sem tentar ler o arquivo', async () => {
    const mock = vi.fn().mockResolvedValueOnce(resposta({}, 403)) as unknown as typeof fetch;
    await expect(localizarESolicitarPasse('token', mock)).rejects.toBeInstanceOf(ErroLoginGoogle);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('leitura do arquivo com HTTP de erro recusa com mensagem própria', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(resposta({ files: [{ id: 'file-123', name: 'passe.json' }] }))
      .mockResolvedValueOnce(resposta({}, 404)) as unknown as typeof fetch;
    await expect(localizarESolicitarPasse('token', mock)).rejects.toBeInstanceOf(ErroLoginGoogle);
  });

  it('conteúdo que não é JSON válido recusa em vez de propagar o erro de parse cru', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(resposta({ files: [{ id: 'file-123', name: 'passe.json' }] }))
      .mockResolvedValueOnce(resposta('não é json')) as unknown as typeof fetch;
    await expect(localizarESolicitarPasse('token', mock)).rejects.toBeInstanceOf(ErroLoginGoogle);
  });
});
