import { decodificarBase64 } from './bytes';
import { branchAtual, repoAtual, type Fetcher } from './github';

export const CAMINHO_TRIADE = '05_Sistema/triade/funcoes.json';
export const CHAVE_LATERAL_TRIADE = 'notas-web.lateral-triade';

export type ClienteTriade = 'pc' | 'celular' | 'web';
export type EstadoTriade =
  | 'feito'
  | 'parcial'
  | 'pendente'
  | 'nao_se_aplica'
  | 'nao_verificado';

export interface ClienteFuncaoTriade {
  estado: EstadoTriade;
  onde: string;
  versao: string;
  data: string;
  nota: string;
}

export interface FuncaoTriade {
  id: string;
  titulo: string;
  descricao: string;
  origem: string;
  clientes: Record<ClienteTriade, ClienteFuncaoTriade>;
}

export interface RegistroTriade {
  versao: 1;
  atualizadoEm: string;
  funcoes: FuncaoTriade[];
}

export type EstadoRegistroTriade =
  | { tipo: 'pronto'; registro: RegistroTriade }
  | { tipo: 'ausente' | 'invalido' | 'indisponivel'; mensagem: string };

const CLIENTES: ClienteTriade[] = ['pc', 'celular', 'web'];
const ESTADOS = new Set<EstadoTriade>([
  'feito',
  'parcial',
  'pendente',
  'nao_se_aplica',
  'nao_verificado',
]);
const ROTULOS_CLIENTE: Record<ClienteTriade, string> = {
  pc: 'PC',
  celular: 'Celular',
  web: 'Web',
};
const ROTULOS_ESTADO: Record<EstadoTriade, string> = {
  feito: 'Feito',
  parcial: 'Parcial',
  pendente: 'Pendente',
  nao_se_aplica: 'Não se aplica',
  nao_verificado: 'Não verificado',
};

function texto(valor: unknown): valor is string {
  return typeof valor === 'string';
}

function clienteValido(valor: unknown): valor is ClienteFuncaoTriade {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return false;
  const dados = valor as Partial<ClienteFuncaoTriade>;
  if (!dados.estado || !ESTADOS.has(dados.estado)) return false;
  if (![dados.onde, dados.versao, dados.data, dados.nota].every(texto)) return false;
  if (dados.estado === 'feito' && !dados.versao?.trim()) return false;
  if (dados.estado === 'nao_se_aplica' && !dados.nota?.trim()) return false;
  return dados.estado !== 'pendente' || /^\d{4}-\d{2}-\d{2}$/.test(dados.data ?? '');
}

function funcaoValida(valor: unknown): valor is FuncaoTriade {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return false;
  const funcao = valor as Partial<FuncaoTriade>;
  if (![funcao.id, funcao.titulo, funcao.descricao, funcao.origem].every(texto)) return false;
  if (!funcao.id?.trim() || !funcao.clientes || typeof funcao.clientes !== 'object') return false;
  if (Object.keys(funcao.clientes).sort().join(',') !== [...CLIENTES].sort().join(',')) return false;
  return CLIENTES.every((cliente) => clienteValido(funcao.clientes?.[cliente]));
}

export function analisarRegistroTriade(valor: unknown): EstadoRegistroTriade {
  const invalido = (): EstadoRegistroTriade => ({
    tipo: 'invalido',
    mensagem: 'Registro da tríade inválido. Rode o verificador no PC e sincronize o vault.',
  });
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return invalido();
  const registro = valor as Partial<RegistroTriade>;
  if (
    registro.versao !== 1 ||
    !texto(registro.atualizadoEm) ||
    Number.isNaN(Date.parse(registro.atualizadoEm)) ||
    !Array.isArray(registro.funcoes) ||
    !registro.funcoes.every(funcaoValida)
  ) return invalido();
  const ids = registro.funcoes.map((funcao) => funcao.id);
  if (new Set(ids).size !== ids.length) return invalido();
  return { tipo: 'pronto', registro: registro as RegistroTriade };
}

export async function lerRegistroTriade(
  token: string,
  fetcher: Fetcher = fetch,
): Promise<EstadoRegistroTriade> {
  try {
    const caminho = CAMINHO_TRIADE.split('/').map(encodeURIComponent).join('/');
    const resposta = await fetcher(
      `https://api.github.com/repos/${repoAtual()}/contents/${caminho}?ref=${branchAtual()}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );
    if (resposta.status === 404) {
      return { tipo: 'ausente', mensagem: 'Registro da tríade ainda não foi sincronizado.' };
    }
    if (!resposta.ok) {
      return { tipo: 'indisponivel', mensagem: 'Não foi possível ler a tríade agora. As notas continuam disponíveis.' };
    }
    const dados = (await resposta.json()) as { content?: unknown };
    if (typeof dados.content !== 'string') return analisarRegistroTriade(null);
    try {
      return analisarRegistroTriade(JSON.parse(decodificarBase64(dados.content).texto));
    } catch {
      return analisarRegistroTriade(null);
    }
  } catch {
    return { tipo: 'indisponivel', mensagem: 'Não foi possível ler a tríade agora. As notas continuam disponíveis.' };
  }
}

export function faltaNoCliente(funcao: FuncaoTriade, cliente: ClienteTriade): boolean {
  const { estado } = funcao.clientes[cliente];
  return estado !== 'feito' && estado !== 'nao_se_aplica';
}

export function filtrarFuncoesTriade(
  funcoes: readonly FuncaoTriade[],
  cliente: ClienteTriade | 'todos',
  soPendentes: boolean,
): FuncaoTriade[] {
  return funcoes.filter((funcao) => {
    const clientes = cliente === 'todos' ? CLIENTES : [cliente];
    if (soPendentes) {
      return clientes.some((nome) => funcao.clientes[nome].estado === 'pendente');
    }
    return cliente === 'todos' || faltaNoCliente(funcao, cliente);
  });
}

function elemento<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  classe?: string,
  texto?: string,
): HTMLElementTagNameMap[K] {
  const item = document.createElement(tag);
  if (classe) item.className = classe;
  if (texto !== undefined) item.textContent = texto;
  return item;
}

function botaoFiltro(rotulo: string, aoClicar: () => void): HTMLButtonElement {
  const botao = elemento('button', 'triade-filtro', rotulo);
  botao.type = 'button';
  botao.addEventListener('click', aoClicar);
  return botao;
}

export function criarVisorTriade(estado: EstadoRegistroTriade): HTMLElement {
  const pagina = elemento('section', 'triade-corpo');
  if (estado.tipo !== 'pronto') {
    pagina.append(
      elemento('p', 'sobretitulo', 'TRÍADE · REGISTRO ÚNICO'),
      elemento('h1', '', 'Paridade dos clientes'),
      elemento('p', 'mensagem triade-mensagem', estado.mensagem),
    );
    return pagina;
  }

  const { registro } = estado;
  let cliente: ClienteTriade | 'todos' = 'todos';
  let soPendentes = false;
  const topo = elemento('header', 'triade-topo');
  const intro = elemento('div');
  intro.append(
    elemento('p', 'sobretitulo', 'TRÍADE · REGISTRO ÚNICO'),
    elemento('h1', '', 'O mesmo Life SO, nos três lugares'),
    elemento('p', 'triade-intro', 'Compare o que já chegou ao PC, ao celular e à web. Abra uma linha para ver a medição e a origem.'),
  );
  const atualizacao = elemento(
    'p',
    'triade-atualizacao',
    `${registro.funcoes.length} funções\nAtualizado em ${new Date(registro.atualizadoEm).toLocaleString('pt-BR')}`,
  );
  topo.append(intro, atualizacao);

  const resumo = elemento('div', 'triade-resumo');
  resumo.setAttribute('aria-label', 'Resumo do que falta');
  const filtros = elemento('div', 'triade-filtros');
  filtros.setAttribute('aria-label', 'Filtros da tríade');
  const tabela = elemento('div', 'triade-tabela');
  tabela.setAttribute('role', 'table');
  tabela.setAttribute('aria-label', 'Funções por cliente');
  const contagem = elemento('span', 'triade-contagem');

  const desenhar = (): void => {
    const visiveis = filtrarFuncoesTriade(registro.funcoes, cliente, soPendentes);
    contagem.textContent = `${visiveis.length} ${visiveis.length === 1 ? 'linha' : 'linhas'}`;
    filtros.querySelectorAll<HTMLButtonElement>('button[data-cliente]').forEach((botao) => {
      botao.classList.toggle('ativa', botao.dataset.cliente === cliente);
      botao.setAttribute('aria-pressed', String(botao.dataset.cliente === cliente));
    });
    resumo.querySelectorAll<HTMLButtonElement>('button[data-cliente]').forEach((botao) => {
      botao.classList.toggle('ativa', botao.dataset.cliente === cliente);
      botao.setAttribute('aria-pressed', String(botao.dataset.cliente === cliente));
    });
    tabela.replaceChildren();
    const titulos = elemento('div', 'triade-linha triade-titulos');
    titulos.setAttribute('role', 'row');
    for (const rotulo of ['Função', 'PC', 'Celular', 'Web']) {
      const coluna = elemento('span', '', rotulo);
      coluna.setAttribute('role', 'columnheader');
      titulos.append(coluna);
    }
    tabela.append(titulos);
    for (const funcao of visiveis) {
      const detalhe = elemento('details', 'triade-registro');
      const linha = elemento('summary', 'triade-linha');
      const titulo = elemento('span', 'triade-funcao', funcao.titulo);
      linha.append(titulo);
      for (const nome of CLIENTES) {
        const dados = funcao.clientes[nome];
        const celula = elemento('span', 'triade-celula');
        const selo = elemento('span', `triade-estado ${dados.estado}`, ROTULOS_ESTADO[dados.estado]);
        celula.append(selo);
        if (dados.versao) celula.append(elemento('small', '', dados.versao));
        linha.append(celula);
      }
      const corpo = elemento('div', 'triade-detalhe');
      corpo.append(elemento('p', '', funcao.descricao), elemento('p', 'triade-origem', `Origem · ${funcao.origem}`));
      const clientes = elemento('div', 'triade-clientes');
      for (const nome of CLIENTES) {
        const item = funcao.clientes[nome];
        const bloco = elemento('section');
        bloco.append(elemento('h2', '', ROTULOS_CLIENTE[nome]), elemento('p', '', item.onde || 'Local ainda não registrado.'));
        if (item.versao) bloco.append(elemento('p', '', `Versão · ${item.versao}`));
        if (item.nota) bloco.append(elemento('p', '', item.nota));
        clientes.append(bloco);
      }
      corpo.append(clientes);
      detalhe.append(linha, corpo);
      tabela.append(detalhe);
    }
    if (!visiveis.length) tabela.append(elemento('p', 'vazio', 'Nenhuma função corresponde a estes filtros.'));
  };

  for (const nome of CLIENTES) {
    const numero = registro.funcoes.filter((funcao) => faltaNoCliente(funcao, nome)).length;
    const botao = botaoFiltro(`Falta no ${ROTULOS_CLIENTE[nome]}\n${numero}\nde ${registro.funcoes.length} funções`, () => {
      cliente = cliente === nome ? 'todos' : nome;
      desenhar();
    });
    botao.className = 'triade-metrica';
    botao.dataset.cliente = nome;
    resumo.append(botao);
  }

  for (const nome of ['todos', ...CLIENTES] as const) {
    const rotulo = nome === 'todos' ? 'Todas' : `Falta no ${ROTULOS_CLIENTE[nome]}`;
    const botao = botaoFiltro(rotulo, () => {
      cliente = nome;
      desenhar();
    });
    botao.dataset.cliente = nome;
    filtros.append(botao);
  }
  const pendentes = elemento('label', 'triade-pendentes');
  const caixa = elemento('input');
  caixa.type = 'checkbox';
  caixa.addEventListener('change', () => {
    soPendentes = caixa.checked;
    desenhar();
  });
  pendentes.append(caixa, document.createTextNode('Só pendentes'));
  filtros.append(pendentes, contagem);
  pagina.append(topo, resumo, filtros, tabela);
  desenhar();
  return pagina;
}
