import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { codificarBase64, codificarEstado } from './bytes';
import {
  CaminhoExistente,
  ConflitoGitHub,
  conflitoParaTela,
  criarNota,
  lerBlob,
  lerNota,
  listarNotasComSha,
  PASTA,
  salvarNota,
  validarCaminho,
  type NotaRemota,
} from './github';
import { BloqueioInatividade, conectarBloqueio } from './lock';
import { criarLateral, type Lateral } from './lateral';
import {
  CHAVE_LATERAL_MATERIAIS,
  construirArvoreMateriais,
  grandeParaLinkDireto,
  lerManifestoMateriais,
  tamanhoLegivel,
  urlAbrir,
  urlBaixar,
  type EstadoMateriais,
  type Material,
} from './materiais';
import { analisarRenomeacao, apagar, mover, planejarExclusao, planejarMovimento, planejarRenomeacao, renomear, type OrigemMovimento } from './operacoes';
import { acaoWikilink, posicaoDaSecao, renderizarMarkdown, resolverWikilink, rolarParaSecao } from './markdown';
import {
  carregarAnexo,
  comprimirImagem,
  enviarAnexo,
  hidratarImagens,
  listarAnexos,
  nomeDeColagem,
  resolverAnexo,
} from './anexos';
import { configurarLivePreview, livePreview, type OpcoesLivePreview } from './NotaLivePreview';
import { mesmoTexto, preservarQuebras, textoExato } from './NotaBytes';
import { sugestaoDeWikilinks } from './WikilinkAutocomplete';
import { guardarToken, lerToken, sair } from './session';
import { guardarPreferenciasRemotas, lerPreferenciasRemotas } from './preferencias';
import {
  aplicarTema,
  guardarPreferenciaTema,
  lerPreferenciaTema,
  paletaEfetiva,
  realceMarkdown,
  type ModoCor,
  type TemaMarkdown,
} from './themes';
import {
  construirArvore,
  entradasDaPasta,
  filtrarNotas,
  nomeDaNota,
  pastaDaNota,
  trilhaDaPasta,
  type ArvoreNotas,
  type NotaArvore,
} from './tree';
import './style.css';

const raiz = document.querySelector<HTMLDivElement>('#app') as HTMLDivElement;
if (!raiz) throw new Error('Contêiner principal ausente.');

const midiaEscura = window.matchMedia('(prefers-color-scheme: dark)');
const compartimentoTema = new Compartment();
const compartimentoPreview = new Compartment();
const compartimentoNumeros = new Compartment();
let preferenciaTema = lerPreferenciaTema(localStorage);
let token = lerToken(sessionStorage);
/** A lista de anexos é buscada uma vez por sessão; as imagens têm cache próprio. */
let anexosConhecidos: string[] | null = null;
/**
 * A busca em voo, compartilhada: uma nota com dez imagens no modo ao vivo pede
 * a lista dez vezes ao mesmo tempo, e sem isto seriam dez chamadas iguais.
 */
let buscaDeAnexos: Promise<string[]> | null = null;
async function listaDeAnexos(): Promise<string[]> {
  if (anexosConhecidos) return anexosConhecidos;
  if (!token) return [];
  buscaDeAnexos ??= listarAnexos(token);
  try {
    anexosConhecidos = await buscaDeAnexos;
  } finally {
    buscaDeAnexos = null;
  }
  return anexosConhecidos ?? [];
}
async function hidratarAnexos(host: ParentNode): Promise<void> {
  if (!token || !host.querySelector('img[data-anexo]')) return;
  try {
    await hidratarImagens(host, token, await listaDeAnexos());
  } catch {
    // A imagem que não carregar já fica marcada como faltante pelo hidratarImagens.
  }
}
/** O anexo pronto para desenhar no modo ao vivo, ou nulo quando não resolve. */
async function imagemDoEmbed(alvo: string): Promise<string | null> {
  if (!token) return null;
  const caminho = resolverAnexo(await listaDeAnexos(), alvo);
  if (!caminho) return null;
  return carregarAnexo(token, caminho);
}
let caminhos: string[] = [];
let blobs = new Map<string, string>();
let pastasPendentes = new Set<string>();
let treeSha = '';
let arvore: ArvoreNotas = construirArvore([]);
let pastaAtual = '';
let pastaRetorno = '';
let nota: NotaRemota | null = null;
let editor: EditorView | null = null;
let estadoSalvo: EditorState | null = null;
let textoSalvoAtual: string | null = null;
let salvando = false;
let movendo = false;
let salvarAtual: ((forcar?: boolean) => Promise<boolean>) | null = null;
let pararBloqueio: (() => void) | null = null;
let casca: HTMLElement | null = null;
let conteudo: HTMLElement | null = null;
let lateral: Lateral | null = null;
let lateralMateriais: Lateral | null = null;
let estadoMateriais: EstadoMateriais = { tipo: 'ausente', mensagem: 'Manifesto ainda não gerado. Rode o gerador no PC e sincronize o vault.' };
let arvoreMateriais: ArvoreNotas = construirArvoreMateriais([]);
let materiaisPorCaminho = new Map<string, Material>();
let secaoAtual: 'conhecimento' | 'materiais' = 'conhecimento';
let pastaMaterialAtual = '';
const rolagemLaterais = { conhecimento: 0, materiais: 0 };
let botaoLateral: HTMLButtonElement | null = null;
let botaoVoltar: HTMLButtonElement | null = null;
let subtituloCabecalho: HTMLElement | null = null;
let telaAtual: 'entrada' | 'lista' | 'carregando' | 'nota' | 'materiais' = 'entrada';
let sequenciaAbertura = 0;

interface RascunhoMemoria {
  nota: NotaRemota;
  texto: string;
  pastaRetorno: string;
}

let rascunhoMemoria: RascunhoMemoria | null = null;

function elemento<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  classe?: string,
  texto?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  if (texto !== undefined) el.textContent = texto;
  return el;
}

function erroSeguro(erro: unknown): string {
  if (erro instanceof Error) return erro.message;
  return 'Não foi possível concluir a operação.';
}

function limpar(): void {
  editor?.destroy();
  editor = null;
  estadoSalvo = null;
  salvarAtual = null;
  conteudo?.replaceChildren();
}

function limparPendentesMaterializadas(): void {
  for (const pendente of pastasPendentes) {
    if (caminhos.some((caminho) => caminho.startsWith(`${PASTA}${pendente}/`))) pastasPendentes.delete(pendente);
  }
}

function confirmarDescarte(): boolean {
  return !temAlteracoes() || window.confirm('Descartar as alterações não gravadas?');
}

function telaPequena(): boolean {
  return window.matchMedia('(max-width: 680px)').matches;
}

function sincronizarLateral(): void {
  if (!casca || !lateral || !botaoLateral) return;
  const painel = secaoAtual === 'materiais' ? lateralMateriais : lateral;
  if (!painel) return;
  const aberta = lateral.aberta();
  casca.classList.toggle('lateral-aberta', aberta);
  painel.elemento.hidden = !aberta;
  botaoLateral.setAttribute('aria-expanded', String(aberta));
  botaoLateral.setAttribute('aria-label', aberta ? 'Fechar coluna lateral' : 'Abrir coluna lateral');
  botaoLateral.setAttribute('aria-controls', painel.elemento.id);
  const fundo = casca.querySelector<HTMLButtonElement>('.lateral-fundo');
  if (fundo) fundo.hidden = !aberta || !telaPequena();
}

function definirLateralAberta(aberta: boolean): void {
  lateral?.definirAberta(aberta);
  lateralMateriais?.definirAberta(aberta);
  sincronizarLateral();
}

function atualizarAbas(): void {
  for (const aside of [lateral?.elemento, lateralMateriais?.elemento]) {
    aside?.querySelectorAll<HTMLButtonElement>('.aba-secao').forEach((botao) => {
      const ativa = botao.dataset.secao === secaoAtual;
      botao.classList.toggle('ativa', ativa);
      if (ativa) botao.setAttribute('aria-current', 'page');
      else botao.removeAttribute('aria-current');
    });
  }
}

function selecionarSecao(secao: 'conhecimento' | 'materiais'): void {
  if (secao === secaoAtual) return;
  if (!confirmarDescarte()) return;
  const anterior = secaoAtual === 'materiais' ? lateralMateriais : lateral;
  const proximo = secao === 'materiais' ? lateralMateriais : lateral;
  if (!anterior || !proximo) return;
  rolagemLaterais[secaoAtual] = anterior.elemento.querySelector('.lateral-arvore')?.scrollTop ?? 0;
  secaoAtual = secao;
  anterior.elemento.replaceWith(proximo.elemento);
  proximo.elemento.querySelector('.lateral-arvore')?.scrollTo(0, rolagemLaterais[secao]);
  atualizarAbas();
  sincronizarLateral();
  if (secao === 'materiais') mostrarMateriais();
  else mostrarLista('', false);
}

function inserirAbas(painel: Lateral): void {
  const abas = elemento('nav', 'abas-secao');
  abas.setAttribute('aria-label', 'Áreas do app');
  for (const [secao, nome] of [['conhecimento', 'Conhecimento'], ['materiais', 'Materiais']] as const) {
    const botao = elemento('button', 'aba-secao', nome);
    botao.type = 'button';
    botao.dataset.secao = secao;
    botao.addEventListener('click', () => selecionarSecao(secao));
    abas.append(botao);
  }
  painel.elemento.prepend(abas);
}

function atualizarCabecalho(subtitulo: string, mostrarVoltar = false): void {
  if (subtituloCabecalho) {
    subtituloCabecalho.textContent = subtitulo;
    subtituloCabecalho.hidden = !subtitulo;
  }
  if (botaoVoltar) botaoVoltar.hidden = !mostrarVoltar;
}

function sistemaEscuro(): boolean {
  return midiaEscura.matches;
}

function atualizarTema(): void {
  aplicarTema(document.documentElement, preferenciaTema, sistemaEscuro());
  if (editor) {
    editor.dispatch({
      effects: compartimentoTema.reconfigure(
        realceMarkdown(paletaEfetiva(preferenciaTema, sistemaEscuro())),
      ),
    });
  }
}

midiaEscura.addEventListener('change', atualizarTema);
atualizarTema();

/**
 * Os seletores são refeitos a cada troca de tela; guardá-los é o que deixa a
 * preferência que veio do vault aparecer neles sem esperar o próximo desenho.
 */
let seletorTema: HTMLSelectElement | null = null;
let seletorModo: HTMLSelectElement | null = null;
let preferenciasSincronizadas = false;
let avisouFalhaDeTema = false;

/**
 * O tema mora no vault, não só no navegador: `localStorage` não atravessa
 * máquina, e era por isso que a mesma conta abria com cores diferentes na UFES
 * e em casa. O valor local continua valendo na abertura -- ele é instantâneo e
 * funciona sem rede --, e o do vault o substitui quando chega.
 */
async function sincronizarPreferenciasDoVault(): Promise<void> {
  if (preferenciasSincronizadas || !token) return;
  preferenciasSincronizadas = true;
  try {
    const remota = await lerPreferenciasRemotas(token);
    if (!remota) return;
    const { preferencia } = remota;
    if (preferencia.tema === preferenciaTema.tema && preferencia.modo === preferenciaTema.modo) {
      return;
    }
    preferenciaTema = preferencia;
    guardarPreferenciaTema(localStorage, preferenciaTema);
    if (seletorTema) seletorTema.value = preferenciaTema.tema;
    if (seletorModo) seletorModo.value = preferenciaTema.modo;
    atualizarTema();
  } catch {
    // Tema é conforto, não conteúdo: falhar em lê-lo não pode barrar a nota.
    preferenciasSincronizadas = false;
  }
}

/** Uma vez por sessão: a falha aparece, mas não vira alarme a cada troca. */
function avisarFalhaDeTema(erro: unknown): void {
  if (avisouFalhaDeTema) return;
  avisouFalhaDeTema = true;
  window.alert(
    `O tema valeu neste navegador, mas não chegou ao vault: ${erroSeguro(erro)}`,
  );
}

function seletoresTema(): HTMLElement {
  const grupo = elemento('div', 'tema-controles');
  const tema = elemento('select', 'tema-seletor') as HTMLSelectElement;
  tema.setAttribute('aria-label', 'Tema do Markdown');
  for (const [valor, rotulo] of [
    ['padrao', 'Padrão'],
    ['obsidian', 'Obsidian'],
    ['solarized', 'Solarized'],
  ] as const) {
    const opcao = elemento('option', '', rotulo);
    opcao.value = valor;
    tema.append(opcao);
  }
  tema.value = preferenciaTema.tema;

  const modo = elemento('select', 'tema-seletor') as HTMLSelectElement;
  modo.setAttribute('aria-label', 'Aparência clara ou escura');
  for (const [valor, rotulo] of [
    ['system', 'Sistema'],
    ['light', 'Claro'],
    ['dark', 'Escuro'],
  ] as const) {
    const opcao = elemento('option', '', rotulo);
    opcao.value = valor;
    modo.append(opcao);
  }
  modo.value = preferenciaTema.modo;

  seletorTema = tema;
  seletorModo = modo;

  const guardar = (): void => {
    preferenciaTema = { tema: tema.value as TemaMarkdown, modo: modo.value as ModoCor };
    guardarPreferenciaTema(localStorage, preferenciaTema);
    atualizarTema();
    if (!token) return;
    const escolhido = preferenciaTema;
    void guardarPreferenciasRemotas(token, escolhido).catch(avisarFalhaDeTema);
  };
  tema.addEventListener('change', guardar);
  modo.addEventListener('change', guardar);
  grupo.append(tema, modo);
  return grupo;
}

function encerrarSessao(): void {
  sequenciaAbertura += 1;
  pararBloqueio?.();
  pararBloqueio = null;
  sair(sessionStorage);
  token = null;
  anexosConhecidos = null;
  buscaDeAnexos = null;
  preferenciasSincronizadas = false;
  caminhos = [];
  blobs = new Map();
  treeSha = '';
  arvore = construirArvore([]);
  estadoMateriais = { tipo: 'ausente', mensagem: 'Manifesto ainda não gerado. Rode o gerador no PC e sincronize o vault.' };
  arvoreMateriais = construirArvoreMateriais([]);
  materiaisPorCaminho = new Map();
  secaoAtual = 'conhecimento';
  pastaMaterialAtual = '';
  pastasPendentes.clear();
  nota = null;
}

function botaoSair(): HTMLButtonElement {
  const botao = elemento('button', 'botao botao-sutil', 'Sair');
  botao.type = 'button';
  botao.addEventListener('click', () => {
    if (!confirmarDescarte()) return;
    rascunhoMemoria = null;
    encerrarSessao();
    mostrarEntrada();
  });
  return botao;
}

function cabecalho(): HTMLElement {
  const header = elemento('header', 'cabecalho');
  botaoLateral = elemento('button', 'botao botao-sutil botao-lateral', '☰');
  botaoLateral.type = 'button';
  botaoLateral.setAttribute('aria-controls', 'explorador-notas');
  botaoLateral.addEventListener('click', () => definirLateralAberta(!lateral?.aberta()));
  botaoVoltar = elemento('button', 'botao botao-sutil botao-voltar', '← Pasta');
  botaoVoltar.type = 'button';
  botaoVoltar.hidden = true;
  botaoVoltar.addEventListener('click', () => {
    if (!confirmarDescarte()) return;
    pastaAtual = pastaRetorno;
    mostrarLista();
  });
  const marca = elemento('div', 'marca');
  marca.append(elemento('span', 'marca-sinal', '06'), elemento('strong', '', 'Conhecimento'));
  subtituloCabecalho = elemento('span', 'caminho');
  subtituloCabecalho.hidden = true;
  marca.append(subtituloCabecalho);
  const acoes = elemento('div', 'cabecalho-acoes');
  acoes.append(seletoresTema(), botaoSair());
  header.append(botaoLateral, botaoVoltar, marca, acoes);
  return header;
}

function montarCasca(): void {
  if (casca) return;
  casca = elemento('div', 'app-shell');
  const header = cabecalho();
  const corpo = elemento('div', 'app-corpo');
  lateral = criarLateral(
    arvore,
    localStorage,
    (caminho) => {
      if (telaAtual === 'nota' && nota?.caminho === caminho) {
        if (telaPequena()) definirLateralAberta(false);
        return;
      }
      if (!confirmarDescarte()) return;
      pastaAtual = pastaDaNota(caminho);
      if (telaPequena()) definirLateralAberta(false);
      void abrirNota(caminho, '', 'fonte', pastaAtual);
    },
    (caminho) => {
      pastaAtual = caminho;
      if (telaAtual === 'lista') mostrarLista('', false);
    },
    !telaPequena(),
    (origem, destino) => void moverInterativo(origem, destino),
    (origem) => void renomearInterativo(origem),
    (pasta) => {
      if (!confirmarDescarte()) return;
      pastaAtual = pasta;
      mostrarCriacao();
    },
    (pasta) => mostrarNovaPasta(pasta),
    (origem) => void apagarInterativo(origem),
  );
  lateral.elemento.id = 'explorador-notas';
  lateralMateriais = criarLateral(
    arvoreMateriais,
    localStorage,
    (caminho) => {
      const material = materiaisPorCaminho.get(caminho);
      if (material) window.open(urlAbrir(material), '_blank', 'noopener,noreferrer');
      if (telaPequena()) definirLateralAberta(false);
    },
    (caminho) => {
      pastaMaterialAtual = caminho;
      if (telaAtual === 'materiais') mostrarMateriais();
    },
    !telaPequena(),
    undefined, undefined, undefined, undefined, undefined,
    {
      chaveEstado: CHAVE_LATERAL_MATERIAIS,
      titulo: 'CENTRAL_MATERIAIS',
      unidade: 'PDFs',
      ariaLabel: 'Pastas e PDFs dos materiais',
      simboloArquivo: '▣',
    },
  );
  lateralMateriais.elemento.id = 'explorador-materiais';
  inserirAbas(lateral);
  inserirAbas(lateralMateriais);
  atualizarAbas();
  conteudo = elemento('main', 'app-conteudo');
  corpo.append(lateral.elemento, conteudo);
  const fundo = elemento('button', 'lateral-fundo');
  fundo.type = 'button';
  fundo.setAttribute('aria-label', 'Fechar coluna lateral');
  fundo.addEventListener('click', () => {
    definirLateralAberta(false);
    botaoLateral?.focus();
  });
  casca.append(header, corpo, fundo);
  raiz.replaceChildren(casca);
  sincronizarLateral();
}

window.addEventListener('keydown', (evento) => {
  if (evento.key !== 'Escape' || !telaPequena() || !lateral?.aberta()) return;
  definirLateralAberta(false);
  botaoLateral?.focus();
});
window.addEventListener('resize', sincronizarLateral);

function capturarRascunho(): boolean {
  if (!temAlteracoes() || !editor || !nota) return true;
  try {
    rascunhoMemoria = {
      nota: { ...nota, texto: textoSalvoAtual ?? nota.texto },
      texto: textoExato(editor.state),
      pastaRetorno,
    };
    return true;
  } catch (erro) {
    window.alert(`A página não foi bloqueada porque não conseguiu preservar a edição: ${erroSeguro(erro)}`);
    return false;
  }
}

function trancarPorInatividade(): boolean {
  if (!capturarRascunho()) return false;
  encerrarSessao();
  mostrarEntrada('Sessão bloqueada por inatividade. Entre novamente para continuar.');
  return true;
}

function iniciarBloqueio(): void {
  pararBloqueio?.();
  const controlador = new BloqueioInatividade(trancarPorInatividade);
  pararBloqueio = conectarBloqueio(controlador, window, document);
}

function mostrarEntrada(mensagem = ''): void {
  limpar();
  raiz.replaceChildren();
  casca = null;
  conteudo = null;
  lateral = null;
  botaoLateral = null;
  botaoVoltar = null;
  subtituloCabecalho = null;
  lateralMateriais = null;
  telaAtual = 'entrada';
  const pagina = elemento('main', 'entrada');
  const painel = elemento('section', 'entrada-painel');
  painel.append(
    elemento('div', 'marca-grande', '06'),
    elemento('p', 'sobretitulo', 'VAULT · ACESSO DIRETO'),
    elemento('h1', '', 'Notas de conhecimento'),
    elemento('p', 'entrada-descricao', 'Leia e edite 06_Conhecimento sem depender de outro computador.'),
  );
  const form = elemento('form', 'form-token');
  const label = elemento('label', '', 'Token do GitHub');
  label.htmlFor = 'token';
  const input = elemento('input', 'campo') as HTMLInputElement;
  input.id = 'token';
  input.name = 'token';
  input.type = 'password';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.required = true;
  input.placeholder = 'github_pat_…';
  const botao = elemento('button', 'botao botao-primario', 'Entrar');
  botao.type = 'submit';
  const status = elemento('p', 'mensagem erro', mensagem);
  status.hidden = !mensagem;
  form.append(label, input, botao, status);
  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const valor = input.value;
    botao.disabled = true;
    botao.textContent = 'Verificando…';
    status.hidden = true;
    try {
      const [lista, materiais] = await Promise.all([listarNotasComSha(valor), lerManifestoMateriais(valor)]);
      caminhos = lista.caminhos;
      blobs = lista.blobs;
      treeSha = lista.treeSha;
      arvore = construirArvore(caminhos, [...pastasPendentes]);
      estadoMateriais = materiais;
      arvoreMateriais = construirArvoreMateriais(materiais.tipo === 'pronto' ? materiais.manifesto.arquivos : []);
      materiaisPorCaminho = new Map(materiais.tipo === 'pronto' ? materiais.manifesto.arquivos.map((item) => [item.caminho, item]) : []);
      guardarToken(sessionStorage, valor);
      token = valor;
      input.value = '';
      iniciarBloqueio();
      mostrarLista();
      void sincronizarPreferenciasDoVault();
      if (rascunhoMemoria) oferecerRascunho();
    } catch (erro) {
      status.textContent = erroSeguro(erro);
      status.hidden = false;
      botao.disabled = false;
      botao.textContent = 'Entrar';
    }
  });
  painel.append(
    form,
    elemento(
      'p',
      'aviso-compartilhado',
      'Máquina compartilhada: a sessão bloqueia após 15 minutos sem uso ou 5 minutos com a aba oculta.',
    ),
  );
  pagina.append(painel);
  raiz.append(pagina);
  input.focus();
}

async function abrirNota(
  caminho: string,
  secao = '',
  modoInicial: 'fonte' | 'preview' | 'leitura' = 'fonte',
  retorno = pastaAtual,
): Promise<void> {
  if (!token) return mostrarEntrada();
  const abertura = ++sequenciaAbertura;
  pastaRetorno = retorno;
  mostrarCarregando(caminho);
  try {
    const carregada = await lerNota(token, caminho);
    if (abertura !== sequenciaAbertura) return;
    nota = carregada;
    mostrarNota(modoInicial, secao);
  } catch (erro) {
    if (abertura !== sequenciaAbertura) return;
    mostrarLista(erroSeguro(erro));
  }
}

function mostrarCarregando(caminho: string): void {
  limpar();
  montarCasca();
  telaAtual = 'carregando';
  casca?.classList.remove('nota-ativa');
  atualizarCabecalho(caminho);
  lateral?.selecionarNota(arvore.notas.some((item) => item.caminho === caminho) ? caminho : null);
  const carregando = elemento('section', 'estado-central');
  carregando.append(elemento('div', 'spinner'), elemento('p', '', 'Abrindo nota…'));
  conteudo?.append(carregando);
}

function itemDeNota(item: NotaArvore, mostrarCaminho: boolean): HTMLButtonElement {
  const botao = elemento('button', 'item-nota');
  botao.type = 'button';
  const texto = elemento('span', 'item-texto');
  texto.append(elemento('span', 'item-nome', item.nome));
  if (mostrarCaminho) texto.append(elemento('span', 'item-caminho', item.caminho));
  botao.append(elemento('span', 'item-marca', 'MD'), texto, elemento('span', 'item-seta', '→'));
  botao.addEventListener('click', () => void abrirNota(item.caminho, '', 'fonte', pastaAtual));
  return botao;
}

function mostrarLista(mensagem = '', focarBusca = true): void {
  limpar();
  montarCasca();
  telaAtual = 'lista';
  nota = null;
  casca?.classList.remove('nota-ativa');
  atualizarCabecalho(`${arvore.notas.length} notas`);
  lateral?.selecionarNota(null);
  if (!arvore.pastas.has(pastaAtual)) pastaAtual = '';
  const pasta = arvore.pastas.get(pastaAtual) ?? arvore.raiz;
  const corpo = elemento('section', 'lista-corpo');
  const topo = elemento('div', 'lista-topo');
  const titulos = elemento('div');
  titulos.append(
    elemento('p', 'sobretitulo', '06_CONHECIMENTO'),
    elemento('h1', '', pastaAtual ? pasta.nome : 'Escolha o que estudar'),
  );
  const nova = elemento('button', 'botao botao-primario', 'Nova nota');
  nova.type = 'button';
  nova.addEventListener('click', mostrarCriacao);
  const novaPasta = elemento('button', 'botao botao-sutil', 'Nova pasta');
  novaPasta.type = 'button';
  novaPasta.addEventListener('click', () => mostrarNovaPasta(pastaAtual));
  const acoesCriacao = elemento('div', 'lista-acoes');
  const verMateriais = elemento('button', 'botao botao-sutil', 'Materiais');
  verMateriais.type = 'button';
  verMateriais.addEventListener('click', () => selecionarSecao('materiais'));
  acoesCriacao.append(verMateriais, novaPasta, nova);
  topo.append(titulos, acoesCriacao);

  const trilha = elemento('nav', 'trilha');
  trilha.setAttribute('aria-label', 'Pastas da nota');
  for (const [indice, parte] of trilhaDaPasta(pastaAtual).entries()) {
    if (indice > 0) trilha.append(elemento('span', 'trilha-separador', '/'));
    const botao = elemento('button', 'trilha-item', parte.nome);
    botao.type = 'button';
    botao.disabled = parte.caminho === pastaAtual;
    botao.addEventListener('click', () => {
      pastaAtual = parte.caminho;
      mostrarLista();
    });
    trilha.append(botao);
  }

  const busca = elemento('input', 'campo busca') as HTMLInputElement;
  busca.type = 'search';
  busca.placeholder = 'Filtrar pelo nome em todas as pastas';
  busca.autocomplete = 'off';
  busca.setAttribute('aria-label', 'Filtrar notas por nome');
  const feedback = elemento('p', 'mensagem erro', mensagem);
  feedback.hidden = !mensagem;
  const contador = elemento('p', 'contador');
  const lista = elemento('div', 'lista-notas');

  const renderizar = (): void => {
    const termo = busca.value.trim();
    lista.replaceChildren();
    if (termo) {
      const resultados = filtrarNotas(arvore, termo);
      contador.textContent = `${resultados.length} ${resultados.length === 1 ? 'resultado' : 'resultados'} em toda a árvore`;
      if (resultados.length === 0) {
        lista.append(elemento('p', 'vazio', 'Nenhuma nota corresponde a esse nome.'));
        return;
      }
      for (const resultado of resultados) lista.append(itemDeNota(resultado, true));
      return;
    }

    const entradas = entradasDaPasta(arvore, pastaAtual);
    contador.textContent = `${pasta.totalNotas} ${pasta.totalNotas === 1 ? 'nota' : 'notas'} nesta pasta e abaixo`;
    if (entradas.length === 0) {
      lista.append(elemento('p', 'vazio', 'Esta pasta ainda não tem notas.'));
      return;
    }
    for (const entrada of entradas) {
      if (entrada.tipo === 'nota') {
        lista.append(itemDeNota(entrada, false));
        continue;
      }
      const item = elemento('button', 'item-nota item-pasta');
      item.type = 'button';
      const texto = elemento('span', 'item-texto');
      texto.append(
        elemento('span', 'item-nome', entrada.nome),
        elemento('span', 'item-caminho', entrada.pendente
          ? 'Pendente: vazia; some ao recarregar até receber uma nota'
          : `${entrada.totalNotas} ${entrada.totalNotas === 1 ? 'nota' : 'notas'}`),
      );
      item.append(elemento('span', 'item-marca', 'DIR'), texto, elemento('span', 'item-seta', '→'));
      item.addEventListener('click', () => {
        pastaAtual = entrada.caminho;
        mostrarLista();
      });
      lista.append(item);
    }
  };
  busca.addEventListener('input', renderizar);
  corpo.append(topo, trilha, busca, feedback, contador, lista);
  conteudo?.append(corpo);
  renderizar();
  if (focarBusca) busca.focus();
}

function mostrarMateriais(): void {
  limpar();
  montarCasca();
  telaAtual = 'materiais';
  nota = null;
  casca?.classList.remove('nota-ativa');
  lateral?.selecionarNota(null);
  if (!arvoreMateriais.pastas.has(pastaMaterialAtual)) pastaMaterialAtual = '';
  const pasta = arvoreMateriais.pastas.get(pastaMaterialAtual) ?? arvoreMateriais.raiz;
  atualizarCabecalho('Materiais · Google Drive');
  const corpo = elemento('section', 'lista-corpo materiais-corpo');
  const topo = elemento('div', 'lista-topo');
  const titulos = elemento('div');
  titulos.append(
    elemento('p', 'sobretitulo', 'CENTRAL_MATERIAIS · UFES'),
    elemento('h1', '', pastaMaterialAtual ? pasta.nome : 'Materiais de estudo'),
  );
  const voltar = elemento('button', 'botao botao-sutil', 'Conhecimento');
  voltar.type = 'button';
  voltar.addEventListener('click', () => selecionarSecao('conhecimento'));
  topo.append(titulos, voltar);
  corpo.append(topo);

  if (estadoMateriais.tipo !== 'pronto') {
    corpo.append(elemento('p', 'mensagem materiais-estado', estadoMateriais.mensagem));
    conteudo?.append(corpo);
    return;
  }

  const atualizado = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date(estadoMateriais.manifesto.geradoEm));
  corpo.append(elemento('p', 'materiais-resumo', `${arvoreMateriais.notas.length} PDFs no Drive · atualizado em ${atualizado}`));
  if (estadoMateriais.antigo) {
    corpo.append(elemento('p', 'mensagem materiais-estado', 'Este índice tem mais de 7 dias. Gere-o novamente no PC e sincronize o vault.'));
  }
  const trilha = elemento('nav', 'trilha');
  trilha.setAttribute('aria-label', 'Pastas dos materiais');
  const partes = pastaMaterialAtual ? pastaMaterialAtual.split('/') : [];
  for (let i = 0; i <= partes.length; i += 1) {
    if (i > 0) trilha.append(elemento('span', 'trilha-separador', '/'));
    const caminho = partes.slice(0, i).join('/');
    const botao = elemento('button', 'trilha-item', i === 0 ? 'Materiais' : partes[i - 1]);
    botao.type = 'button';
    botao.disabled = caminho === pastaMaterialAtual;
    botao.addEventListener('click', () => {
      pastaMaterialAtual = caminho;
      mostrarMateriais();
    });
    trilha.append(botao);
  }
  corpo.append(trilha);
  corpo.append(elemento('p', 'contador', `${pasta.totalNotas} ${pasta.totalNotas === 1 ? 'PDF' : 'PDFs'} nesta pasta e abaixo`));
  const lista = elemento('div', 'lista-notas');
  const entradas = entradasDaPasta(arvoreMateriais, pastaMaterialAtual);
  if (entradas.length === 0) lista.append(elemento('p', 'vazio', 'Nenhum PDF nesta pasta.'));
  for (const entrada of entradas) {
    if (entrada.tipo === 'pasta') {
      const botao = elemento('button', 'item-nota item-pasta');
      botao.type = 'button';
      const texto = elemento('span', 'item-texto');
      texto.append(elemento('span', 'item-nome', entrada.nome), elemento('span', 'item-caminho', `${entrada.totalNotas} PDFs`));
      botao.append(elemento('span', 'item-marca', 'DIR'), texto, elemento('span', 'item-seta', '→'));
      botao.addEventListener('click', () => {
        pastaMaterialAtual = entrada.caminho;
        mostrarMateriais();
      });
      lista.append(botao);
      continue;
    }
    const material = materiaisPorCaminho.get(entrada.caminho);
    if (!material) continue;
    const linha = elemento('div', 'item-material');
    linha.dataset.caminho = material.caminho;
    const identificacao = elemento('div', 'material-identificacao');
    identificacao.append(elemento('span', 'item-marca', 'PDF'));
    const texto = elemento('div', 'item-texto');
    const nome = elemento('span', 'item-nome', material.name);
    nome.title = material.name;
    const tamanho = elemento('span', 'item-caminho material-tamanho', tamanhoLegivel(material.size));
    texto.append(nome, tamanho);
    if (grandeParaLinkDireto(material)) {
      texto.append(elemento('span', 'material-grande', 'Arquivo grande · baixar no Drive'));
    }
    identificacao.append(texto);
    const acoes = elemento('div', 'material-acoes');
    const abrir = elemento('a', 'botao botao-sutil material-abrir', 'Abrir');
    abrir.href = urlAbrir(material);
    abrir.target = '_blank';
    abrir.rel = 'noopener noreferrer';
    abrir.setAttribute('aria-label', `Abrir ${material.name} no Drive`);
    const baixar = elemento('a', 'botao botao-sutil material-baixar', grandeParaLinkDireto(material) ? 'Baixar no Drive' : 'Baixar');
    baixar.href = urlBaixar(material);
    baixar.target = '_blank';
    baixar.rel = 'noopener noreferrer';
    baixar.setAttribute('aria-label', `Baixar ${material.name}${grandeParaLinkDireto(material) ? ' pela página do Drive' : ''}`);
    acoes.append(abrir, baixar);
    linha.append(identificacao, acoes);
    lista.append(linha);
  }
  corpo.append(lista);
  conteudo?.append(corpo);
}

function mostrarNovaPasta(pastaPai: string): void {
  const resposta = window.prompt('Nome da nova pasta (fica pendente até receber uma nota):');
  if (resposta === null) return;
  const nome = resposta.trim();
  const caminho = `${pastaPai ? `${pastaPai}/` : ''}${nome}`;
  try {
    if (!nome || nome.startsWith('/') || nome.endsWith('/') || nome.includes('\\')) throw new Error('Nome de pasta inválido.');
    validarCaminho(`${PASTA}${caminho}/__validacao__.md`);
    if (arvore.pastas.has(caminho)) throw new CaminhoExistente();
    pastasPendentes.add(caminho);
    arvore = construirArvore(caminhos, [...pastasPendentes]);
    lateral?.atualizarArvore(arvore);
    pastaAtual = caminho;
    if (telaAtual === 'lista') mostrarLista('', false);
    window.alert('Pasta pendente na tela. Ela só será gravada no Git quando receber a primeira nota; se recarregar antes, desaparecerá.');
  } catch (erro) { window.alert(erroSeguro(erro)); }
}

function mostrarCriacao(): void {
  if (!token) return mostrarEntrada();
  const dialogo = elemento('dialog', 'dialogo');
  const form = elemento('form', 'dialogo-conteudo');
  form.method = 'dialog';
  const destino = `${PASTA}${pastaAtual ? `${pastaAtual}/` : ''}`;
  form.append(
    elemento('p', 'sobretitulo', 'NOVA NOTA'),
    elemento('h2', '', 'Dê um nome ao arquivo'),
    elemento('p', 'dialogo-texto', `Destino: ${destino}. Use subpastas no nome, por exemplo Anatomia/Ossos do crânio.`),
  );
  const label = elemento('label', '', 'Nome da nota');
  label.htmlFor = 'nome-nota';
  const input = elemento('input', 'campo') as HTMLInputElement;
  input.id = 'nome-nota';
  input.required = true;
  input.placeholder = 'Ex.: Anatomia/Ossos do crânio';
  const erro = elemento('p', 'mensagem erro');
  erro.hidden = true;
  const acoes = elemento('div', 'dialogo-acoes');
  const cancelar = elemento('button', 'botao botao-sutil', 'Cancelar');
  cancelar.type = 'button';
  cancelar.addEventListener('click', () => dialogo.close());
  const criar = elemento('button', 'botao botao-primario', 'Criar nota');
  criar.type = 'submit';
  acoes.append(cancelar, criar);
  form.append(label, input, erro, acoes);
  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    let nome = input.value.trim();
    if (!/\.md$/i.test(nome)) nome += '.md';
    const caminho = `${destino}${nome}`;
    try {
      validarCaminho(caminho);
      if (!nomeDaNota(caminho)) throw new Error('Nome da nota obrigatório.');
    } catch (falha) {
      erro.textContent = erroSeguro(falha);
      erro.hidden = false;
      return;
    }
    criar.disabled = true;
    criar.textContent = 'Criando…';
    try {
      const resultado = await criarNota(
        token as string,
        caminho,
        codificarBase64('', false),
        caminhos,
      );
      caminhos = [...caminhos, caminho].sort((a, b) => a.localeCompare(b, 'pt-BR'));
      limparPendentesMaterializadas();
      arvore = construirArvore(caminhos, [...pastasPendentes]);
      lateral?.atualizarArvore(arvore);
      blobs.set(caminho, resultado.sha);
      treeSha = resultado.treeSha ?? '';
      nota = {
        caminho,
        sha: resultado.sha,
        texto: '',
        tinhaBom: false,
        somenteLeitura: false,
        eol: 'lf',
      };
      pastaRetorno = pastaDaNota(caminho);
      pastaAtual = pastaRetorno;
      dialogo.close();
      mostrarNota();
    } catch (falha) {
      erro.textContent = falha instanceof CaminhoExistente ? falha.message : erroSeguro(falha);
      erro.hidden = false;
      criar.disabled = false;
      criar.textContent = 'Criar nota';
    }
  });
  dialogo.append(form);
  document.body.append(dialogo);
  dialogo.addEventListener('close', () => dialogo.remove());
  dialogo.showModal();
  input.focus();
}

function mostrarEscolhaDestino(origem: OrigemMovimento): void {
  const dialogo = elemento('dialog', 'dialogo');
  const form = elemento('form', 'dialogo-conteudo');
  form.append(
    elemento('p', 'sobretitulo', 'MOVER'),
    elemento('h2', '', origem.tipo === 'nota' ? 'Mover nota para…' : 'Mover pasta para…'),
  );
  const label = elemento('label', '', 'Pasta de destino');
  label.htmlFor = 'destino-movimento';
  const seletor = elemento('select', 'campo') as HTMLSelectElement;
  seletor.id = 'destino-movimento';
  for (const pasta of arvore.pastas.values()) {
    if (origem.tipo === 'pasta' &&
      (pasta.caminho === origem.caminho || pasta.caminho.startsWith(`${origem.caminho}/`))) continue;
    const opcao = elemento('option', '', pasta.caminho || '06_Conhecimento (raiz)');
    opcao.value = pasta.caminho;
    seletor.append(opcao);
  }
  const acoes = elemento('div', 'dialogo-acoes');
  const cancelar = elemento('button', 'botao botao-sutil', 'Cancelar');
  cancelar.type = 'button';
  cancelar.addEventListener('click', () => dialogo.close());
  const confirmar = elemento('button', 'botao botao-primario', 'Mover');
  confirmar.type = 'submit';
  acoes.append(cancelar, confirmar);
  form.append(label, seletor, acoes);
  form.addEventListener('submit', (evento) => {
    evento.preventDefault();
    dialogo.close();
    void moverInterativo(origem, seletor.value);
  });
  dialogo.append(form);
  document.body.append(dialogo);
  dialogo.addEventListener('close', () => dialogo.remove());
  dialogo.showModal();
  seletor.focus();
}

async function moverInterativo(origem: OrigemMovimento, destino?: string): Promise<void> {
  if (destino === undefined) return mostrarEscolhaDestino(origem);
  if (!token || movendo) return;
  try {
    planejarMovimento(origem, destino, blobs);
  } catch (erro) {
    window.alert(erroSeguro(erro));
    return;
  }
  if (temAlteracoes()) {
    if (!window.confirm('Há alterações não gravadas. Salvar antes de mover? Cancelar mantém a edição aberta.')) return;
    if (!salvarAtual || !(await salvarAtual())) return;
  }
  movendo = true;
  try {
    if (!treeSha) {
      const lista = await listarNotasComSha(token);
      caminhos = lista.caminhos;
      blobs = lista.blobs;
      treeSha = lista.treeSha;
      planejarMovimento(origem, destino, blobs);
    }
    const resultado = await mover(token, origem, destino, blobs, treeSha);
    const novosBlobs = new Map(blobs);
    for (const antigo of resultado.caminhos.keys()) novosBlobs.delete(antigo);
    for (const [antigo, novo] of resultado.caminhos) novosBlobs.set(novo, blobs.get(antigo) as string);
    blobs = novosBlobs;
    treeSha = resultado.treeSha;
    caminhos = caminhos.map((caminho) => resultado.caminhos.get(caminho) ?? caminho)
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
    limparPendentesMaterializadas();
    const prefixoAntigo = origem.tipo === 'pasta' ? `${origem.caminho}/` : '';
    const prefixoNovo = origem.tipo === 'pasta'
      ? `${destino ? `${destino}/` : ''}${origem.caminho.split('/').at(-1)}/` : '';
    const remapearPasta = (pasta: string): string =>
      prefixoAntigo && (pasta === origem.caminho || pasta.startsWith(prefixoAntigo))
        ? `${prefixoNovo.slice(0, -1)}${pasta.slice(origem.caminho.length)}` : pasta;
    pastaAtual = remapearPasta(pastaAtual);
    pastaRetorno = remapearPasta(pastaRetorno);
    if (nota && resultado.caminhos.has(nota.caminho)) {
      nota.caminho = resultado.caminhos.get(nota.caminho) as string;
      pastaRetorno = pastaDaNota(nota.caminho);
      pastaAtual = pastaRetorno;
      atualizarCabecalho(nota.caminho, true);
    }
    arvore = construirArvore(caminhos, [...pastasPendentes]);
    lateral?.atualizarArvore(arvore);
    if (nota) lateral?.selecionarNota(nota.caminho);
    if (telaAtual === 'lista') {
      const rolagem = conteudo?.scrollTop ?? 0;
      mostrarLista('', false);
      if (conteudo) conteudo.scrollTop = rolagem;
    }
  } catch (erro) {
    if (erro instanceof ConflitoGitHub) {
      if (window.confirm('O repositório mudou durante a operação. Recarregar a página para obter a versão nova?')) {
        window.location.reload();
      }
    } else window.alert(erroSeguro(erro));
  } finally {
    movendo = false;
  }
}

async function renomearInterativo(origem: OrigemMovimento): Promise<void> {
  if (!token || movendo) return;
  const atual = origem.caminho.split('/').at(-1) as string;
  const resposta = window.prompt('Novo nome:', origem.tipo === 'nota' ? atual.replace(/\.md$/i, '') : atual);
  if (resposta === null) return;
  const nome = resposta.trim();
  try {
    planejarRenomeacao(origem, nome, blobs);
  } catch (erro) { window.alert(erroSeguro(erro)); return; }
  if (temAlteracoes()) {
    if (!window.confirm('Há alterações não gravadas. Salvar antes de renomear? Cancelar mantém a edição aberta.')) return;
    if (!salvarAtual || !(await salvarAtual())) return;
  }
  movendo = true;
  try {
    if (!treeSha) {
      const lista = await listarNotasComSha(token);
      caminhos = lista.caminhos; blobs = lista.blobs; treeSha = lista.treeSha;
    }
    const plano = await analisarRenomeacao(token, origem, nome, blobs);
    const aviso = origem.tipo === 'nota'
      ? `Renomear ${atual}?\n${plano.reescritos} wikilink(s) serão reescritos. ${plano.ignorados} ficarão de fora (ambiguidade ou nota somente leitura) e poderão apontar para o nome antigo.`
      : `Renomear a pasta ${atual} e suas ${plano.caminhos.size} nota(s)? Os wikilinks por nome continuam válidos.`;
    if (!window.confirm(aviso)) return;
    const resultado = await renomear(token, origem, plano, blobs, treeSha);
    const novosBlobs = new Map(blobs);
    for (const antigo of resultado.caminhos.keys()) novosBlobs.delete(antigo);
    for (const [antigo, novo] of resultado.caminhos) {
      novosBlobs.set(novo, resultado.blobsReescritos.get(antigo) ?? blobs.get(antigo) as string);
    }
    for (const [caminho, sha] of resultado.blobsReescritos) {
      if (!resultado.caminhos.has(caminho)) novosBlobs.set(caminho, sha);
    }
    blobs = novosBlobs;
    treeSha = resultado.treeSha;
    caminhos = caminhos.map((caminho) => resultado.caminhos.get(caminho) ?? caminho)
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
    limparPendentesMaterializadas();
    if (origem.tipo === 'pasta') {
      const novoCaminho = (resultado.caminhos.values().next().value as string).slice(PASTA.length);
      const prefixoNovo = novoCaminho.split('/').slice(0, origem.caminho.split('/').length).join('/');
      const remapear = (pasta: string): string => pasta === origem.caminho || pasta.startsWith(`${origem.caminho}/`)
        ? `${prefixoNovo}${pasta.slice(origem.caminho.length)}` : pasta;
      pastaAtual = remapear(pastaAtual);
      pastaRetorno = remapear(pastaRetorno);
    }
    if (nota) {
      const reescrita = plano.reescritas.find((item) => item.caminho === nota?.caminho);
      if (reescrita) {
        nota.texto = reescrita.texto;
        nota.sha = resultado.blobsReescritos.get(reescrita.caminho) as string;
      }
      nota.caminho = resultado.caminhos.get(nota.caminho) ?? nota.caminho;
      pastaRetorno = pastaDaNota(nota.caminho);
      pastaAtual = pastaRetorno;
    }
    arvore = construirArvore(caminhos, [...pastasPendentes]);
    lateral?.atualizarArvore(arvore);
    if (nota && telaAtual === 'nota') mostrarNota();
    else if (telaAtual === 'lista') mostrarLista('', false);
    window.alert(`Renomeado. ${plano.reescritos} wikilink(s) reescritos; ${plano.ignorados} ficaram de fora.`);
  } catch (erro) {
    if (erro instanceof ConflitoGitHub) {
      if (window.confirm('O repositório mudou durante a operação. Recarregar a página para obter a versão nova?')) window.location.reload();
    } else window.alert(erroSeguro(erro));
  } finally { movendo = false; }
}

async function apagarInterativo(origem: OrigemMovimento): Promise<void> {
  if (!token || movendo) return;
  const pendente = origem.tipo === 'pasta' && pastasPendentes.has(origem.caminho);
  let removidos: string[];
  try { removidos = pendente ? [] : planejarExclusao(origem, blobs); }
  catch (erro) { window.alert(erroSeguro(erro)); return; }
  const notaAfetada = Boolean(nota && removidos.includes(nota.caminho));
  const nome = origem.caminho.split('/').at(-1) as string;
  const aviso = pendente
    ? `Apagar a pasta pendente “${nome}”? Ela ainda não foi gravada no repositório.`
    : origem.tipo === 'pasta'
      ? `Apagar “${nome}” e as ${removidos.length} notas dentro dela?`
      : `Apagar a nota “${nome}”?`;
  const historico = pendente ? '' : '\nO conteúdo poderá ser recuperado pelo histórico do repositório.';
  const edicao = notaAfetada && temAlteracoes() ? '\nA edição aberta não gravada será perdida.' : '';
  if (!window.confirm(`${aviso}${historico}${edicao}`)) return;
  movendo = true;
  try {
    if (pendente) {
      for (const pasta of pastasPendentes) {
        if (pasta === origem.caminho || pasta.startsWith(`${origem.caminho}/`)) pastasPendentes.delete(pasta);
      }
    } else {
      if (!treeSha) {
        const lista = await listarNotasComSha(token);
        caminhos = lista.caminhos; blobs = lista.blobs; treeSha = lista.treeSha;
        removidos = planejarExclusao(origem, blobs);
      }
      const resultado = await apagar(token, origem, blobs, treeSha);
      const removidosSet = new Set(resultado.removidos);
      caminhos = caminhos.filter((caminho) => !removidosSet.has(caminho));
      for (const caminho of resultado.removidos) blobs.delete(caminho);
      treeSha = resultado.treeSha;
    }
    if (origem.tipo === 'pasta') {
      const pai = origem.caminho.split('/').slice(0, -1).join('/');
      const dentro = (pasta: string): boolean => pasta === origem.caminho || pasta.startsWith(`${origem.caminho}/`);
      if (dentro(pastaAtual)) pastaAtual = pai;
      if (dentro(pastaRetorno)) pastaRetorno = pai;
    }
    if (notaAfetada && nota) {
      pastaAtual = origem.tipo === 'nota' ? pastaDaNota(origem.caminho) : pastaAtual;
      nota = null;
    }
    arvore = construirArvore(caminhos, [...pastasPendentes]);
    lateral?.atualizarArvore(arvore);
    if (notaAfetada || telaAtual === 'lista') mostrarLista('', false);
  } catch (erro) {
    if (erro instanceof ConflitoGitHub) {
      if (window.confirm('O repositório mudou durante a operação. Recarregar a página para obter a versão nova?')) window.location.reload();
    } else window.alert(erroSeguro(erro));
  } finally { movendo = false; }
}

function mostrarNota(
  modoInicial: 'fonte' | 'preview' | 'leitura' = 'fonte',
  secao = '',
  textoBaseSalvo?: string,
): void {
  if (!nota || !token) return mostrarEntrada();
  limpar();
  montarCasca();
  telaAtual = 'nota';
  casca?.classList.add('nota-ativa');
  atualizarCabecalho(nota.caminho, true);
  lateral?.selecionarNota(nota.caminho);
  const pagina = elemento('div', 'nota-shell');

  const barra = elemento('section', 'barra-nota');
  const modos = elemento('div', 'modos');
  const fonte = elemento('button', 'modo ativo', 'Fonte');
  const preview = elemento('button', 'modo', 'Ao vivo');
  const leitura = elemento('button', 'modo', 'Leitura');
  fonte.type = preview.type = leitura.type = 'button';
  modos.append(fonte, preview, leitura);
  const direita = elemento('div', 'acoes-nota');
  const estado = elemento('span', 'estado-salvo', 'Salvo');
  const salvar = elemento('button', 'botao botao-primario', 'Salvar');
  salvar.type = 'button';
  direita.append(estado, salvar);
  barra.append(modos, direita);
  pagina.append(barra);

  if (nota.somenteLeitura) {
    const aviso = elemento(
      'p',
      'aviso aviso-perigo',
      'Esta nota contém CR isolado. Ela foi aberta em somente-leitura e não pode ser salva com segurança.',
    );
    pagina.append(aviso);
    salvar.disabled = true;
  }

  const area = elemento('section', 'area-nota');
  const editorHost = elemento('div', 'editor-host');
  editorHost.dataset.modo = modoInicial === 'preview' ? 'preview' : 'fonte';
  const leituraHost = elemento('article', 'leitura-markdown');
  leituraHost.hidden = true;
  area.append(editorHost, leituraHost);
  pagina.append(area);
  conteudo?.append(pagina);

  const atualizarEstado = (): void => {
    if (!editor || !estadoSalvo) return;
    const alterado = !mesmoTexto(editor.state, estadoSalvo);
    estado.textContent = alterado ? 'Alterações não gravadas' : 'Salvo';
    estado.classList.toggle('alterado', alterado);
  };

  /**
   * Colar print direto no editor (I.5). Grava o anexo no repositório e insere
   * `![[nome]]` no cursor -- o mesmo nome e o mesmo formato que o Obsidian usa,
   * senão a mesma nota abre diferente em cada cliente.
   */
  const colarImagem = (evento: ClipboardEvent, view: EditorView): boolean => {
    const arquivo = [...(evento.clipboardData?.items ?? [])]
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .find((item): item is File => item !== null);
    if (!arquivo) return false;
    if (!token) {
      window.alert('Entre com o token antes de colar imagem.');
      return true;
    }
    if (nota?.somenteLeitura) return true;
    evento.preventDefault();
    const posicao = view.state.selection.main;
    void (async () => {
      try {
        const comprimida = await comprimirImagem(arquivo);
        const bytes = new Uint8Array(await comprimida.arrayBuffer());
        const nome = nomeDeColagem();
        const caminho = await enviarAnexo(token as string, nome, bytes);
        if (anexosConhecidos && !anexosConhecidos.includes(caminho)) {
          anexosConhecidos = [...anexosConhecidos, caminho];
        }
        view.dispatch({
          changes: { from: posicao.from, to: posicao.to, insert: `![[${nome}]]` },
          selection: { anchor: posicao.from + nome.length + 5 },
        });
      } catch (erro) {
        window.alert(erroSeguro(erro));
      }
    })();
    return true;
  };

  const extensoes = [
    compartimentoNumeros.of(modoInicial === 'preview' ? [] : lineNumbers()),
    history(),
    markdown(),
    sugestaoDeWikilinks({
      caminhos,
      caminhoAtual: nota.caminho,
      blobs,
      carregarSecoes: async (_caminho, sha) => (await lerBlob(token as string, sha)).texto,
    }),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    preservarQuebras(nota.texto, nota.eol),
    compartimentoTema.of(realceMarkdown(paletaEfetiva(preferenciaTema, sistemaEscuro()))),
    compartimentoPreview.of(modoInicial === 'preview' ? livePreview(opcoesDoAoVivo()) : []),
    EditorView.lineWrapping,
    EditorView.domEventHandlers({ paste: colarImagem }),
    EditorView.updateListener.of((atualizacao) => {
      if (atualizacao.docChanged) atualizarEstado();
    }),
    EditorView.theme({
      '&': { height: '100%' },
      '.cm-scroller': { overflow: 'auto' },
      '.cm-content': { padding: '24px 0 120px' },
      '.cm-line': { padding: '0 28px' },
      '.cm-gutters': { backgroundColor: 'var(--folha-baixa)', border: 'none' },
    }),
  ];
  if (nota.somenteLeitura) extensoes.push(EditorView.editable.of(false));
  const estadoInicial = EditorState.create({ doc: nota.texto, extensions: extensoes });
  editor = new EditorView({ state: estadoInicial, parent: editorHost });
  textoSalvoAtual = textoBaseSalvo ?? nota.texto;
  estadoSalvo =
    textoSalvoAtual === nota.texto
      ? editor.state
      : EditorState.create({
          doc: textoSalvoAtual,
          extensions: [preservarQuebras(textoSalvoAtual, nota.eol)],
        });
  atualizarEstado();

  const marcarModo = (ativo: HTMLButtonElement): void => {
    for (const botao of [fonte, preview, leitura]) botao.classList.toggle('ativo', botao === ativo);
  };

  salvarAtual = async (forcar = false): Promise<boolean> => {
    if (!editor || !nota || salvando || nota.somenteLeitura || !token) return false;
    if (!temAlteracoes() && !forcar) return true;
    salvando = true;
    salvar.disabled = true;
    salvar.textContent = 'Salvando…';
    try {
      const content = codificarEstado(editor.state, nota.tinhaBom, nota.somenteLeitura);
      const resultado = await salvarNota(token, nota.caminho, content, nota.sha);
      nota.sha = resultado.sha;
      blobs.set(nota.caminho, resultado.sha);
      treeSha = resultado.treeSha ?? '';
      estadoSalvo = editor.state;
      textoSalvoAtual = textoExato(editor.state);
      atualizarEstado();
      return true;
    } catch (erro) {
      if (erro instanceof ConflitoGitHub) mostrarConflito();
      else window.alert(erroSeguro(erro));
      return false;
    } finally {
      salvando = false;
      salvar.disabled = nota?.somenteLeitura ?? false;
      salvar.textContent = 'Salvar';
    }
  };
  const ativarFonte = (): void => {
    if (editor) configurarLivePreview(editor, compartimentoPreview, false);
    editor?.dispatch({ effects: compartimentoNumeros.reconfigure(lineNumbers()) });
    editorHost.dataset.modo = 'fonte';
    editorHost.hidden = false;
    leituraHost.hidden = true;
    marcarModo(fonte);
    editor?.focus();
  };
  const ativarPreview = (): void => {
    if (editor) configurarLivePreview(editor, compartimentoPreview, true, opcoesDoAoVivo());
    editor?.dispatch({ effects: compartimentoNumeros.reconfigure([]) });
    editorHost.dataset.modo = 'preview';
    editorHost.hidden = false;
    leituraHost.hidden = true;
    marcarModo(preview);
    editor?.focus();
  };
  /**
   * O modo ao vivo resolve e navega com as mesmas regras do modo leitura.
   * Wikilink de seção sem alvo aponta para a nota aberta.
   */
  function opcoesDoAoVivo(): OpcoesLivePreview {
    return {
      resolver: (alvo) => resolverWikilink(caminhos, nota?.caminho ?? '', alvo),
      imagem: (alvo) => imagemDoEmbed(alvo),
      aoAbrir: (alvo, secao) => {
        const atual = nota?.caminho ?? '';
        const destino = alvo ? resolverWikilink(caminhos, atual, alvo) : atual;
        const acao = acaoWikilink(destino, secao);
        if (acao.tipo === 'faltante') {
          window.alert(`Nota não encontrada: ${alvo}`);
          return;
        }
        if (acao.caminho === atual && acao.secao) {
          if (!editor) return;
          const posicao = posicaoDaSecao(textoExato(editor.state), acao.secao);
          if (posicao === null) {
            window.alert(`Seção não encontrada: ${acao.secao}`);
            return;
          }
          editor.dispatch({
            selection: { anchor: posicao },
            effects: EditorView.scrollIntoView(posicao, { y: 'start' }),
          });
          return;
        }
        if (!confirmarDescarte()) return;
        void abrirNota(acao.caminho, acao.secao, 'preview', pastaDaNota(acao.caminho));
      },
    };
  }

  const ativarLeitura = (secaoAlvo = ''): void => {
    if (!editor || !nota) return;
    try {
      const texto = textoExato(editor.state);
      leituraHost.innerHTML = renderizarMarkdown(texto, { caminhos, caminhoAtual: nota.caminho });
      void hidratarAnexos(leituraHost);
      editorHost.hidden = true;
      leituraHost.hidden = false;
      marcarModo(leitura);
      if (secaoAlvo) {
        requestAnimationFrame(() => {
          if (!rolarParaSecao(leituraHost, texto, secaoAlvo)) {
            window.alert(`Seção não encontrada: ${secaoAlvo}`);
          }
        });
      }
    } catch (erro) {
      window.alert(erroSeguro(erro));
    }
  };
  fonte.addEventListener('click', ativarFonte);
  preview.addEventListener('click', ativarPreview);
  leitura.addEventListener('click', () => ativarLeitura());
  leituraHost.addEventListener('click', (evento) => {
    const alvoEvento = evento.target;
    if (!(alvoEvento instanceof Element)) return;
    const link = alvoEvento.closest<HTMLAnchorElement>('a.nota-link');
    if (!link) return;
    evento.preventDefault();
    const acao = acaoWikilink(link.dataset.caminho ?? null, link.dataset.secao ?? '');
    if (acao.tipo === 'faltante') {
      window.alert(`Nota não encontrada: ${link.dataset.alvo ?? link.textContent ?? ''}`);
      return;
    }
    if (acao.caminho === nota?.caminho && acao.secao) {
      if (!editor) return;
      try {
        const texto = textoExato(editor.state);
        if (!rolarParaSecao(leituraHost, texto, acao.secao)) {
          window.alert(`Seção não encontrada: ${acao.secao}`);
        }
      } catch (erro) {
        window.alert(erroSeguro(erro));
      }
      return;
    }
    if (!confirmarDescarte()) return;
    void abrirNota(acao.caminho, acao.secao, 'leitura', pastaDaNota(acao.caminho));
  });

  salvar.addEventListener('click', () => { void salvarAtual?.(true); });

  if (modoInicial === 'leitura') ativarLeitura(secao);
  else if (modoInicial === 'preview') ativarPreview();
}

function oferecerRascunho(): void {
  if (!rascunhoMemoria) return;
  const guardado = rascunhoMemoria;
  const dialogo = elemento('dialog', 'dialogo');
  const caixa = elemento('div', 'dialogo-conteudo');
  caixa.append(
    elemento('p', 'sobretitulo', 'EDIÇÃO PRESERVADA'),
    elemento('h2', '', 'Continuar de onde parou?'),
    elemento(
      'p',
      'dialogo-texto',
      `A edição não gravada de ${nomeDaNota(guardado.nota.caminho)} ficou somente na memória desta aba.`,
    ),
  );
  const acoes = elemento('div', 'dialogo-acoes');
  const descartar = elemento('button', 'botao botao-sutil', 'Descartar');
  const restaurar = elemento('button', 'botao botao-primario', 'Restaurar edição');
  descartar.type = restaurar.type = 'button';
  descartar.addEventListener('click', () => {
    rascunhoMemoria = null;
    dialogo.close();
  });
  restaurar.addEventListener('click', () => {
    rascunhoMemoria = null;
    nota = { ...guardado.nota, texto: guardado.texto };
    pastaRetorno = guardado.pastaRetorno;
    dialogo.close();
    mostrarNota('fonte', '', guardado.nota.texto);
  });
  acoes.append(descartar, restaurar);
  caixa.append(acoes);
  dialogo.append(caixa);
  document.body.append(dialogo);
  dialogo.addEventListener('close', () => dialogo.remove());
  dialogo.showModal();
}

function temAlteracoes(): boolean {
  return Boolean(editor && estadoSalvo && !mesmoTexto(editor.state, estadoSalvo));
}

function mostrarConflito(): void {
  if (!editor || !nota || !token) return;
  let textoLocal: string;
  try {
    textoLocal = textoExato(editor.state);
  } catch (erro) {
    window.alert(erroSeguro(erro));
    return;
  }
  const dialogo = elemento('dialog', 'dialogo dialogo-conflito');
  const caixa = elemento('div', 'dialogo-conteudo');
  caixa.append(
    elemento('p', 'sobretitulo perigo', 'CONFLITO DE EDIÇÃO'),
    elemento('h2', '', conflitoParaTela.mensagem),
    elemento(
      'p',
      'dialogo-texto',
      'Copie sua edição abaixo antes de recarregar. Recarregar substitui este texto pela versão nova.',
    ),
  );
  const area = elemento('textarea', 'texto-copiavel') as HTMLTextAreaElement;
  area.readOnly = true;
  area.value = textoLocal;
  area.setAttribute('aria-label', 'Sua edição local para copiar');
  const acoes = elemento('div', 'dialogo-acoes');
  const cancelar = elemento('button', 'botao botao-sutil', 'Cancelar');
  const recarregar = elemento('button', 'botao botao-perigo', 'Recarregar versão nova');
  cancelar.type = recarregar.type = 'button';
  cancelar.addEventListener('click', () => dialogo.close());
  recarregar.addEventListener('click', async () => {
    recarregar.disabled = true;
    recarregar.textContent = 'Recarregando…';
    try {
      nota = await lerNota(token as string, (nota as NotaRemota).caminho);
      dialogo.close();
      mostrarNota();
    } catch (erro) {
      window.alert(erroSeguro(erro));
      recarregar.disabled = false;
      recarregar.textContent = 'Recarregar versão nova';
    }
  });
  acoes.append(cancelar, recarregar);
  caixa.append(area, acoes);
  dialogo.append(caixa);
  document.body.append(dialogo);
  dialogo.addEventListener('close', () => dialogo.remove());
  dialogo.showModal();
  area.select();
}

window.addEventListener('beforeunload', (evento) => {
  if (!temAlteracoes()) return;
  evento.preventDefault();
});

if (token) {
  iniciarBloqueio();
  mostrarCarregando('Carregando lista…');
  Promise.all([listarNotasComSha(token), lerManifestoMateriais(token)])
    .then(([resultado, materiais]) => {
      caminhos = resultado.caminhos;
      blobs = resultado.blobs;
      treeSha = resultado.treeSha;
      arvore = construirArvore(caminhos, [...pastasPendentes]);
      estadoMateriais = materiais;
      arvoreMateriais = construirArvoreMateriais(materiais.tipo === 'pronto' ? materiais.manifesto.arquivos : []);
      materiaisPorCaminho = new Map(materiais.tipo === 'pronto' ? materiais.manifesto.arquivos.map((item) => [item.caminho, item]) : []);
      lateral?.atualizarArvore(arvore);
      lateralMateriais?.atualizarArvore(arvoreMateriais);
      mostrarLista();
      void sincronizarPreferenciasDoVault();
    })
    .catch((erro) => {
      encerrarSessao();
      mostrarEntrada(erroSeguro(erro));
    });
} else {
  mostrarEntrada();
}
