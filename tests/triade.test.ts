// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { codificarBase64 } from '../src/bytes';
import {
  analisarRegistroTriade,
  CAMINHO_TRIADE,
  criarVisorTriade,
  filtrarFuncoesTriade,
  lerRegistroTriade,
  type EstadoTriade,
  type FuncaoTriade,
} from '../src/triade';

const funcao = (
  id: string,
  pc: EstadoTriade,
  celular: EstadoTriade,
  web: EstadoTriade,
): FuncaoTriade => ({
  id,
  titulo: `Função ${id}`,
  descricao: `Descrição ${id}`,
  origem: 'HANDOFF.md §4',
  clientes: Object.fromEntries(
    ([['pc', pc], ['celular', celular], ['web', web]] as const).map(([nome, estado]) => [nome, {
      estado,
      onde: nome,
      versao: estado === 'feito' ? `${nome} abc` : '',
      data: '2026-09-27',
      nota: estado === 'nao_se_aplica' ? 'Motivo medido.' : `Nota ${nome}`,
    }]),
  ) as FuncaoTriade['clientes'],
});

const registro = {
  versao: 1 as const,
  atualizadoEm: '2026-09-27T12:40:00-03:00',
  funcoes: [
    funcao('a', 'feito', 'parcial', 'feito'),
    funcao('b', 'pendente', 'feito', 'nao_se_aplica'),
    funcao('c', 'feito', 'nao_verificado', 'feito'),
  ],
};
const resposta = (dados: unknown, status = 200) => new Response(JSON.stringify(dados), { status });

describe('registro da tríade', () => {
  it('valida estados, versão medida, motivo e ids únicos', () => {
    expect(analisarRegistroTriade(registro).tipo).toBe('pronto');
    expect(analisarRegistroTriade({ ...registro, versao: 2 }).tipo).toBe('invalido');
    expect(analisarRegistroTriade({ ...registro, funcoes: [registro.funcoes[0], registro.funcoes[0]] }).tipo).toBe('invalido');
    const semVersao = structuredClone(registro);
    semVersao.funcoes[0].clientes.pc.versao = '';
    expect(analisarRegistroTriade(semVersao).tipo).toBe('invalido');
  });

  it('lê o caminho fixo e falha sem bloquear notas', async () => {
    const fetcher = vi.fn(async () => resposta({ content: codificarBase64(JSON.stringify(registro), false) })) as unknown as typeof fetch;
    expect((await lerRegistroTriade('token', fetcher)).tipo).toBe('pronto');
    expect(String(vi.mocked(fetcher).mock.calls[0][0])).toContain(`/contents/${CAMINHO_TRIADE.split('/').map(encodeURIComponent).join('/')}?ref=master`);
    const falha = vi.fn(async () => resposta({}, 503)) as unknown as typeof fetch;
    expect((await lerRegistroTriade('token', falha)).tipo).toBe('indisponivel');
  });

  it('filtra lacunas e o visor abre os detalhes da mesma fonte', () => {
    expect(filtrarFuncoesTriade(registro.funcoes, 'celular', false).map((item) => item.id)).toEqual(['a', 'c']);
    expect(filtrarFuncoesTriade(registro.funcoes, 'web', false)).toHaveLength(0);
    const estado = analisarRegistroTriade(registro);
    const visor = criarVisorTriade(estado);
    expect(visor.textContent).toContain('O mesmo Life SO');
    const filtro = [...visor.querySelectorAll<HTMLButtonElement>('.triade-filtro')]
      .find((botao) => botao.textContent === 'Falta no Celular')!;
    filtro.click();
    expect(visor.querySelector('.triade-contagem')?.textContent).toBe('2 linhas');
    const primeiro = visor.querySelector<HTMLDetailsElement>('details')!;
    primeiro.open = true;
    expect(primeiro.textContent).toContain('HANDOFF.md §4');
  });
});
