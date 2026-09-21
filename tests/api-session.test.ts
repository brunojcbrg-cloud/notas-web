import { describe, expect, it, vi } from 'vitest';
import { codificarBase64 } from '../src/bytes';
import {
  CaminhoExistente,
  ConflitoGitHub,
  conflitoParaTela,
  criarNota,
  lerBlob,
  lerNota,
  listarNotas,
  salvarNota,
} from '../src/github';
import { CHAVE_TOKEN, guardarToken, sair, type ArmazenamentoSessao } from '../src/session';

function resposta(dados: unknown, status = 200): Response {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fetchMock(dados: unknown, status = 200): typeof fetch {
  return vi.fn(async () => resposta(dados, status)) as unknown as typeof fetch;
}

describe('casos 11–17 · conflito e API', () => {
  it('11. gravação existente envia o SHA lido', async () => {
    const mock = fetchMock({ content: { sha: 'sha-novo' } });
    await salvarNota('segredo', '06_Conhecimento/Nota.md', 'YQ==', 'sha-lido', mock);
    const init = vi.mocked(mock).mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toMatchObject({ sha: 'sha-lido' });
  });

  it('12. 409 não reenvia e expõe apenas recarregar ou cancelar', async () => {
    const mock = fetchMock({ message: 'Conflict' }, 409);
    await expect(
      salvarNota('segredo', '06_Conhecimento/Nota.md', 'YQ==', 'sha-antigo', mock),
    ).rejects.toBeInstanceOf(ConflitoGitHub);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(conflitoParaTela.acoes).toEqual(['recarregar', 'cancelar']);
  });

  it('13. recarregar após 409 lê conteúdo e SHA novos', async () => {
    const mock = fetchMock({ content: codificarBase64('versão nova', false), sha: 'sha-novo' });
    const nota = await lerNota('segredo', '06_Conhecimento/Nota.md', mock);
    expect(nota).toMatchObject({ texto: 'versão nova', sha: 'sha-novo' });
  });

  it('14. criar nota usa PUT sem campo SHA', async () => {
    const mock = fetchMock({ content: { sha: 'sha-criado' } });
    await criarNota('segredo', '06_Conhecimento/Nova.md', '', [], mock);
    const init = vi.mocked(mock).mock.calls[0]?.[1];
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('sha');
  });

  it('15. caminho existente é recusado sem chamada de rede', async () => {
    const mock = fetchMock({ content: { sha: 'não-usado' } });
    expect(() =>
      criarNota(
        'segredo',
        '06_Conhecimento/Existe.md',
        '',
        ['06_Conhecimento/Existe.md'],
        mock,
      ),
    ).toThrow(CaminhoExistente);
    expect(mock).not.toHaveBeenCalled();
  });

  it('16. lista usa uma chamada à árvore e filtra pasta e extensão', async () => {
    const mock = fetchMock({
      tree: [
        { path: '06_Conhecimento/A.md', type: 'blob' },
        { path: '06_Conhecimento/sub/B.md', type: 'blob' },
        { path: '06_Conhecimento/anexo.png', type: 'blob' },
        { path: '05_Sistema/Fora.md', type: 'blob' },
      ],
    });
    await expect(listarNotas('segredo', mock)).resolves.toEqual([
      '06_Conhecimento/A.md',
      '06_Conhecimento/sub/B.md',
    ]);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(vi.mocked(mock).mock.calls[0]?.[0]).toContain('/git/trees/master?recursive=1');
  });

  it('17. caminho com acento e espaço é codificado na URL', async () => {
    const mock = fetchMock({ content: codificarBase64('ok', false), sha: 'sha' });
    await lerNota(
      'segredo',
      '06_Conhecimento/Semiologia da Cabeça e Pescoço.md',
      mock,
    );
    const url = String(vi.mocked(mock).mock.calls[0]?.[0]);
    expect(url).toContain(
      '06_Conhecimento/Semiologia%20da%20Cabe%C3%A7a%20e%20Pesco%C3%A7o.md',
    );
  });

  it('lê o blob imutável diretamente pelo SHA para permitir cache', async () => {
    const mock = fetchMock({ content: codificarBase64('# Seção', false) });
    await expect(lerBlob('segredo', 'sha-da-nota', mock)).resolves.toMatchObject({
      texto: '# Seção',
    });
    expect(String(vi.mocked(mock).mock.calls[0]?.[0])).toContain('/git/blobs/sha-da-nota');
  });
});

describe('casos 18–20 · token', () => {
  function storageFalso(): ArmazenamentoSessao & {
    dados: Map<string, string>;
    clear: ReturnType<typeof vi.fn>;
  } {
    const dados = new Map<string, string>();
    return {
      dados,
      getItem: (chave) => dados.get(chave) ?? null,
      setItem: (chave, valor) => dados.set(chave, valor),
      clear: vi.fn(() => dados.clear()),
    };
  }

  it('18. token é guardado apenas no armazenamento de sessão fornecido', () => {
    const sessao = storageFalso();
    guardarToken(sessao, 'token-secreto');
    expect(sessao.dados.get(CHAVE_TOKEN)).toBe('token-secreto');
    expect([...sessao.dados.keys()]).toEqual([CHAVE_TOKEN]);
  });

  it('19. Sair limpa toda a sessão e retorna à tela de entrada', () => {
    const sessao = storageFalso();
    guardarToken(sessao, 'token-secreto');
    expect(sair(sessao)).toBe('entrada');
    expect(sessao.clear).toHaveBeenCalledOnce();
    expect(sessao.dados.size).toBe(0);
  });

  it('20. token inválido gera mensagem clara sem vazar o token ou usar console', async () => {
    const segredo = 'github_pat_NUNCA_EXIBIR';
    const mock = fetchMock({ message: 'Bad credentials' }, 401);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let mensagem = '';
    try {
      await listarNotas(segredo, mock);
    } catch (erro) {
      mensagem = (erro as Error).message;
    }
    expect(mensagem).toContain('Token inválido');
    expect(mensagem).not.toContain(segredo);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
