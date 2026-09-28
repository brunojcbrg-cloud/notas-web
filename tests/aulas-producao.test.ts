import { describe, expect, it, vi } from 'vitest';
import { analisarEstadoAulas, lerEstadoAulas, textoEstadoAula } from '../src/aulasProducao';

const resposta = (valor: unknown, status = 200) => new Response(JSON.stringify(valor), { status });

describe('aulas em produção no Drive', () => {
  it('aceita v1 e v2 e traduz fila, progresso e falha', () => {
    const estado = analisarEstadoAulas({ schema: 2, aulas: [
      { id_aula: 'a', nome_final: 'A', status: 'na_fila', posicao: 2 },
      { id_aula: 'b', nome_final: 'B', status: 'produzindo', etapa: 'design', progresso: 86 },
      { id_aula: 'c', nome_final: 'C', status: 'falhou', motivo: 'rede' },
    ] });
    expect(textoEstadoAula(estado.aulas[0])).toContain('posição 2');
    expect(textoEstadoAula(estado.aulas[1])).toBe('Produzindo · design · 86%');
    expect(textoEstadoAula(estado.aulas[2])).toContain('rede');
    expect(analisarEstadoAulas({ schema: 1, aulas: [{ id_aula: 'antiga', status: 'concluida' }] }).aulas[0].nome_final).toBe('Aula');
  });

  it('procura um único estado_aulas.json e lê com Bearer', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(resposta({ files: [{ id: 'estado-1' }] }))
      .mockResolvedValueOnce(resposta({ schema: 2, aulas: [{ id_aula: 'a', status: 'pronta', html: 'https://drive/a' }] }));
    const estado = await lerEstadoAulas('google-token', fetcher as unknown as typeof fetch);
    expect(estado.aulas[0].status).toBe('pronta');
    expect(String(fetcher.mock.calls[0][0])).toContain("name%3D'estado_aulas.json'");
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer google-token');
    expect(String(fetcher.mock.calls[1][0])).toContain('/files/estado-1?alt=media');
  });

  it('recusa duplicidade e schema desconhecido', async () => {
    expect(() => analisarEstadoAulas({ schema: 3, aulas: [] })).toThrow();
    const fetcher = vi.fn().mockResolvedValueOnce(resposta({ files: [{ id: 'a' }, { id: 'b' }] }));
    await expect(lerEstadoAulas('x', fetcher as unknown as typeof fetch)).rejects.toThrow('encontrei 2');
  });
});
