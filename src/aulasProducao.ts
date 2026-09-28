import type { Fetcher } from './github';

export type StatusAula =
  | 'enviada'
  | 'esperando_escolha'
  | 'na_fila'
  | 'produzindo'
  | 'publicando'
  | 'pronta'
  | 'falhou'
  | 'concluida';

export interface EstadoAula {
  id_aula: string;
  nome_final: string;
  materia: string;
  status: StatusAula;
  posicao?: number | null;
  etapa?: string | null;
  progresso?: number | null;
  motivo?: string | null;
  html?: string | null;
}

export interface EstadoAulas {
  schema: 1 | 2;
  atualizado_em?: string;
  aulas: EstadoAula[];
}

const STATUS = new Set<StatusAula>([
  'enviada', 'esperando_escolha', 'na_fila', 'produzindo', 'publicando',
  'pronta', 'falhou', 'concluida',
]);

export function analisarEstadoAulas(valor: unknown): EstadoAulas {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) throw new Error('estado de aulas inválido');
  const dados = valor as Partial<EstadoAulas>;
  if ((dados.schema !== 1 && dados.schema !== 2) || !Array.isArray(dados.aulas)) {
    throw new Error('versão desconhecida do estado de aulas');
  }
  const aulas = dados.aulas.map((bruto) => {
    if (!bruto || typeof bruto !== 'object') throw new Error('aula inválida no estado');
    const aula = bruto as Partial<EstadoAula>;
    if (typeof aula.id_aula !== 'string' || !aula.id_aula || !STATUS.has(aula.status as StatusAula)) {
      throw new Error('aula inválida no estado');
    }
    return {
      id_aula: aula.id_aula,
      nome_final: typeof aula.nome_final === 'string' ? aula.nome_final : 'Aula',
      materia: typeof aula.materia === 'string' ? aula.materia : '',
      status: aula.status as StatusAula,
      posicao: typeof aula.posicao === 'number' ? aula.posicao : null,
      etapa: typeof aula.etapa === 'string' ? aula.etapa : null,
      progresso: typeof aula.progresso === 'number' ? Math.max(0, Math.min(100, aula.progresso)) : null,
      motivo: typeof aula.motivo === 'string' ? aula.motivo : null,
      html: typeof aula.html === 'string' ? aula.html : null,
    };
  });
  return { schema: dados.schema, atualizado_em: dados.atualizado_em, aulas };
}

export async function lerEstadoAulas(accessToken: string, fetcher: Fetcher = fetch): Promise<EstadoAulas> {
  const consulta = encodeURIComponent("name='estado_aulas.json' and trashed=false");
  const busca = await fetcher(
    `https://www.googleapis.com/drive/v3/files?q=${consulta}&fields=files(id,name,modifiedTime)&pageSize=10&spaces=drive`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!busca.ok) throw new Error(`Drive respondeu ${busca.status} ao procurar o estado das aulas`);
  const dados = (await busca.json()) as { files?: Array<{ id?: string }> };
  const ids = (dados.files ?? []).map((item) => item.id).filter((id): id is string => typeof id === 'string');
  if (ids.length !== 1) throw new Error(`esperava um estado_aulas.json; encontrei ${ids.length}`);
  const resposta = await fetcher(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(ids[0])}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!resposta.ok) throw new Error(`Drive respondeu ${resposta.status} ao ler o estado das aulas`);
  return analisarEstadoAulas(await resposta.json());
}

export function textoEstadoAula(aula: EstadoAula): string {
  if (aula.status === 'na_fila') return `Na fila${aula.posicao ? ` · posição ${aula.posicao}` : ''}`;
  if (aula.status === 'produzindo' || aula.status === 'publicando') {
    const etapa = aula.etapa ? ` · ${aula.etapa}` : '';
    const progresso = aula.progresso == null ? '' : ` · ${Math.round(aula.progresso)}%`;
    return `${aula.status === 'publicando' ? 'Publicando' : 'Produzindo'}${etapa}${progresso}`;
  }
  if (aula.status === 'esperando_escolha') return 'Esperando escolha no Life SO';
  if (aula.status === 'pronta' || aula.status === 'concluida') return 'Pronta';
  if (aula.status === 'falhou') return `Falhou${aula.motivo ? ` · ${aula.motivo}` : ''}`;
  return 'Enviada';
}
