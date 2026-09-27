import type { RascunhoPersistente } from './rascunhos';

export const CHAVE_LATERAL_SINCRONIZACAO = 'notas-web.lateral-sincronizacao';
export const CHAVE_ULTIMA_GRAVACAO = 'notas-web.ultima-gravacao';

export interface UltimaGravacao {
  em: number;
  resultado: 'salvo' | 'falhou';
  caminho: string;
  mensagem?: string;
}

export interface EstadoSincronizacaoWeb {
  tipo: 'atualizado' | 'rascunhos' | 'remoto-alterado' | 'falha';
  titulo: string;
  descricao: string;
  rascunhos: RascunhoPersistente[];
  notaAberta: { caminho: string; shaAberto: string; shaRemoto?: string; mudou: boolean } | null;
  ultima: UltimaGravacao | null;
  erro?: string;
}

export function registrarUltimaGravacao(
  storage: Pick<Storage, 'setItem'>,
  gravacao: UltimaGravacao,
): void {
  try { storage.setItem(CHAVE_ULTIMA_GRAVACAO, JSON.stringify(gravacao)); } catch { /* sem persistência */ }
}

export function lerUltimaGravacao(storage: Pick<Storage, 'getItem'>): UltimaGravacao | null {
  try {
    const raw = storage.getItem(CHAVE_ULTIMA_GRAVACAO);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<UltimaGravacao>;
    if (typeof value.em !== 'number' || !['salvo', 'falhou'].includes(value.resultado ?? '') || typeof value.caminho !== 'string') return null;
    return value as UltimaGravacao;
  } catch { return null; }
}

export function avaliarSincronizacaoWeb(opcoes: {
  rascunhos: RascunhoPersistente[];
  caminhoAberto?: string;
  shaAberto?: string;
  shaRemoto?: string;
  ultima: UltimaGravacao | null;
  erro?: string;
}): EstadoSincronizacaoWeb {
  const notaAberta = opcoes.caminhoAberto && opcoes.shaAberto
    ? {
        caminho: opcoes.caminhoAberto,
        shaAberto: opcoes.shaAberto,
        shaRemoto: opcoes.shaRemoto,
        mudou: Boolean(opcoes.shaRemoto && opcoes.shaRemoto !== opcoes.shaAberto),
      }
    : null;
  if (opcoes.erro) return {
    tipo: 'falha', titulo: 'Não foi possível conferir o GitHub',
    descricao: 'Os rascunhos locais continuam preservados neste navegador.',
    rascunhos: opcoes.rascunhos, notaAberta, ultima: opcoes.ultima, erro: opcoes.erro,
  };
  if (notaAberta?.mudou) return {
    tipo: 'remoto-alterado', titulo: 'A nota aberta mudou no GitHub',
    descricao: opcoes.rascunhos.length
      ? 'Há também um rascunho local; abra a nota para resolver sem sobrescrever nenhuma versão.'
      : 'Reabra a nota antes de editar para usar a versão mais recente.',
    rascunhos: opcoes.rascunhos, notaAberta, ultima: opcoes.ultima,
  };
  if (opcoes.rascunhos.length) return {
    tipo: 'rascunhos', titulo: `${opcoes.rascunhos.length} rascunho${opcoes.rascunhos.length === 1 ? '' : 's'} local${opcoes.rascunhos.length === 1 ? '' : 'is'}`,
    descricao: 'Ainda não há confirmação de que estas edições chegaram ao GitHub.',
    rascunhos: opcoes.rascunhos, notaAberta, ultima: opcoes.ultima,
  };
  return {
    tipo: 'atualizado', titulo: 'Sem edições locais pendentes',
    descricao: 'A web grava diretamente no GitHub e não mantém um clone local.',
    rascunhos: [], notaAberta, ultima: opcoes.ultima,
  };
}

function elemento<K extends keyof HTMLElementTagNameMap>(tag: K, classe: string, texto?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = classe;
  if (texto !== undefined) el.textContent = texto;
  return el;
}

export function criarPainelSincronizacaoWeb(
  estado: EstadoSincronizacaoWeb,
  conferir: () => void,
): HTMLElement {
  const pagina = elemento('section', 'sync-web-corpo');
  const topo = elemento('header', 'sync-web-topo');
  const texto = elemento('div', '');
  texto.append(
    elemento('p', 'sobretitulo', 'SINCRONIZAÇÃO · WEB'),
    elemento('h1', '', estado.titulo),
    elemento('p', 'sync-web-intro', estado.descricao),
  );
  const botao = elemento('button', 'botao botao-sutil', 'Conferir agora');
  botao.type = 'button';
  botao.addEventListener('click', conferir);
  topo.append(texto, botao);

  const grade = elemento('div', 'sync-web-grade');
  const ultima = elemento('section', 'sync-web-cartao');
  ultima.append(elemento('h2', '', 'Última gravação'));
  ultima.append(elemento('p', '', estado.ultima
    ? `${new Date(estado.ultima.em).toLocaleString('pt-BR')} · ${estado.ultima.resultado} · ${estado.ultima.caminho}`
    : 'Nenhuma gravação registrada neste navegador.'));

  const local = elemento('section', 'sync-web-cartao');
  local.append(elemento('h2', '', 'Rascunhos locais'));
  local.append(elemento('p', '', estado.rascunhos.length ? `${estado.rascunhos.length} preservado(s)` : 'Nenhum'));
  for (const rascunho of estado.rascunhos.slice(0, 6)) {
    local.append(elemento('code', 'sync-web-linha', rascunho.caminho));
  }

  const comparacao = elemento('section', 'sync-web-cartao');
  comparacao.append(elemento('h2', '', 'Nota aberta × GitHub'));
  if (!estado.notaAberta) comparacao.append(elemento('p', '', 'Nenhuma nota aberta.'));
  else {
    comparacao.append(
      elemento('code', 'sync-web-linha', estado.notaAberta.caminho),
      elemento('p', '', estado.notaAberta.mudou ? 'SHA remoto diferente do SHA aberto.' : 'SHA aberto confere com o remoto.'),
    );
  }
  grade.append(ultima, local, comparacao);
  if (estado.erro) pagina.append(topo, elemento('p', 'mensagem sync-web-erro', estado.erro), grade);
  else pagina.append(topo, grade);
  pagina.append(elemento('p', 'sync-web-limite', 'Limite desta tela: o navegador não possui clone Git; ela compara armazenamento local e SHAs da API do GitHub.'));
  return pagina;
}
