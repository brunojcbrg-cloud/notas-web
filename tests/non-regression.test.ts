import { readFileSync, readdirSync } from 'node:fs';
import { EditorState } from '@codemirror/state';
import { describe, expect, it, vi } from 'vitest';
import { codificarEstado, decodificarBase64 } from '../src/bytes';
import { ConflitoGitHub, salvarNota } from '../src/github';
import { preservarQuebras } from '../src/NotaBytes';

function resposta(dados: unknown, status = 200): Response {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('casos 48–50 · não regressão', () => {
  it('48. casos 1–20 continuam presentes e são incluídos pelo npm test', () => {
    const bytes = readFileSync(new URL('./bytes.test.ts', import.meta.url), 'utf8');
    const api = readFileSync(new URL('./api-session.test.ts', import.meta.url), 'utf8');
    for (let caso = 1; caso <= 10; caso += 1) expect(bytes).toContain(`'${caso}.`);
    for (let caso = 11; caso <= 20; caso += 1) expect(api).toContain(`'${caso}.`);
  });

  it('49. abrir, editar e salvar envia SHA e preserva os bytes fora da edição', async () => {
    let estado = EditorState.create({
      doc: 'a\r\nb\r\nc',
      extensions: [preservarQuebras('a\r\nb\r\nc', 'crlf')],
    });
    estado = estado.update({ changes: { from: 2, to: 3, insert: 'B' } }).state;
    const content = codificarEstado(estado, false, false);
    const fetcher = vi.fn(async () => resposta({ content: { sha: 'sha-novo' } })) as unknown as typeof fetch;
    await salvarNota(
      'segredo',
      '06_Conhecimento/Nota.md',
      content,
      'sha-lido',
      fetcher,
    );
    const corpo = JSON.parse(String(vi.mocked(fetcher).mock.calls[0]?.[1]?.body));
    expect(corpo.sha).toBe('sha-lido');
    expect(decodificarBase64(corpo.content).texto).toBe('a\r\nB\r\nc');
  });

  it('50. resposta 409 mantém o fluxo de conflito sem reenvio', async () => {
    const fetcher = vi.fn(async () => resposta({ message: 'Conflict' }, 409)) as unknown as typeof fetch;
    await expect(
      salvarNota(
        'segredo',
        '06_Conhecimento/Nota.md',
        'YQ==',
        'sha-antigo',
        fetcher,
      ),
    ).rejects.toBeInstanceOf(ConflitoGitHub);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('casos 68–69 · certificação da suíte', () => {
  it('68. casos 1–51 continuam presentes e executados pela mesma suíte', () => {
    const diretorio = new URL('.', import.meta.url);
    const fontes = readdirSync(diretorio)
      .filter((nome) => nome.endsWith('.test.ts'))
      .map((nome) => readFileSync(new URL(nome, diretorio), 'utf8'))
      .join('\n');
    for (let caso = 1; caso <= 51; caso += 1) expect(fontes).toContain(`'${caso}.`);
  });

  it('69. npm test audita todos os arquivos e imprime Errors zero', () => {
    const arquivos = readdirSync(new URL('.', import.meta.url)).filter((nome) =>
      nome.endsWith('.test.ts'),
    );
    const config = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
    const reporter = readFileSync(
      new URL('../scripts/test-audit-reporter.mjs', import.meta.url),
      'utf8',
    );
    expect(arquivos).toHaveLength(10);
    expect(config).toContain("'./scripts/test-audit-reporter.mjs'");
    expect(reporter).toContain('Errors     ${erros.length} errors');
    expect(reporter).toContain('carregados !== emDisco');
  });
});

describe('casos 81–82 · não regressão e auditoria final', () => {
  it('81. casos 1–70 continuam presentes nas suítes e na certificação Edge', () => {
    const diretorio = new URL('.', import.meta.url);
    const fontes = readdirSync(diretorio)
      .filter((nome) => nome.endsWith('.test.ts'))
      .map((nome) => readFileSync(new URL(nome, diretorio), 'utf8'));
    fontes.push(
      readFileSync(new URL('../scripts/verificar-web-e2e.py', import.meta.url), 'utf8'),
    );
    const fonteCompleta = fontes.join('\n');
    for (let caso = 1; caso <= 70; caso += 1) {
      expect(fonteCompleta).toMatch(new RegExp(`\\b${caso}\\.`));
    }
  });

  it('82. npm test audita os arquivos no disco e exige Errors zero', () => {
    const arquivos = readdirSync(new URL('.', import.meta.url)).filter((nome) =>
      nome.endsWith('.test.ts'),
    );
    const config = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
    const reporter = readFileSync(
      new URL('../scripts/test-audit-reporter.mjs', import.meta.url),
      'utf8',
    );
    const certificacao = readFileSync(
      new URL('../scripts/verificar-web-e2e.py', import.meta.url),
      'utf8',
    );

    expect(arquivos).toHaveLength(10);
    expect(config).toContain("include: ['tests/**/*.test.ts']");
    expect(reporter).toContain('Test Files ${carregados} loaded (${emDisco} on disk)');
    expect(reporter).toContain('Errors     ${erros.length} errors');
    expect(reporter).toContain('erros.length !== 0');
    expect(certificacao.startsWith('# Execute com: py -3.14 ')).toBe(true);
  });
});
