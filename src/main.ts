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
  lerNota,
  listarNotasComSha,
  PASTA,
  salvarNota,
  type NotaRemota,
} from './github';
import { BloqueioInatividade, conectarBloqueio } from './lock';
import { criarLateral, type Lateral } from './lateral';
import { analisarRenomeacao, mover, planejarMovimento, planejarRenomeacao, renomear, type OrigemMovimento } from './operacoes';
import { acaoWikilink, renderizarMarkdown, rolarParaSecao } from './markdown';
import { configurarLivePreview, livePreview } from './NotaLivePreview';
import { mesmoTexto, preservarQuebras, textoExato } from './NotaBytes';
import { guardarToken, lerToken, sair } from './session';
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
let caminhos: string[] = [];
let blobs = new Map<string, string>();
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
let botaoLateral: HTMLButtonElement | null = null;
let botaoVoltar: HTMLButtonElement | null = null;
let subtituloCabecalho: HTMLElement | null = null;
let telaAtual: 'entrada' | 'lista' | 'carregando' | 'nota' = 'entrada';
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

function confirmarDescarte(): boolean {
  return !temAlteracoes() || window.confirm('Descartar as alterações não gravadas?');
}

function telaPequena(): boolean {
  return window.matchMedia('(max-width: 680px)').matches;
}

function sincronizarLateral(): void {
  if (!casca || !lateral || !botaoLateral) return;
  const aberta = lateral.aberta();
  casca.classList.toggle('lateral-aberta', aberta);
  lateral.elemento.hidden = !aberta;
  botaoLateral.setAttribute('aria-expanded', String(aberta));
  botaoLateral.setAttribute('aria-label', aberta ? 'Fechar coluna lateral' : 'Abrir coluna lateral');
  const fundo = casca.querySelector<HTMLButtonElement>('.lateral-fundo');
  if (fundo) fundo.hidden = !aberta || !telaPequena();
}

function definirLateralAberta(aberta: boolean): void {
  lateral?.definirAberta(aberta);
  sincronizarLateral();
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

  const guardar = (): void => {
    preferenciaTema = { tema: tema.value as TemaMarkdown, modo: modo.value as ModoCor };
    guardarPreferenciaTema(localStorage, preferenciaTema);
    atualizarTema();
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
  caminhos = [];
  blobs = new Map();
  treeSha = '';
  arvore = construirArvore([]);
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
  );
  lateral.elemento.id = 'explorador-notas';
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
      const lista = await listarNotasComSha(valor);
      caminhos = lista.caminhos;
      blobs = lista.blobs;
      treeSha = lista.treeSha;
      arvore = construirArvore(caminhos);
      guardarToken(sessionStorage, valor);
      token = valor;
      input.value = '';
      iniciarBloqueio();
      mostrarLista();
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
  topo.append(titulos, nova);

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
        elemento('span', 'item-caminho', `${entrada.totalNotas} ${entrada.totalNotas === 1 ? 'nota' : 'notas'}`),
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

function mostrarCriacao(): void {
  if (!token) return mostrarEntrada();
  const dialogo = elemento('dialog', 'dialogo');
  const form = elemento('form', 'dialogo-conteudo');
  form.method = 'dialog';
  const destino = `${PASTA}${pastaAtual ? `${pastaAtual}/` : ''}`;
  form.append(
    elemento('p', 'sobretitulo', 'NOVA NOTA'),
    elemento('h2', '', 'Dê um nome ao arquivo'),
    elemento('p', 'dialogo-texto', `Destino: ${destino}`),
  );
  const label = elemento('label', '', 'Nome da nota');
  label.htmlFor = 'nome-nota';
  const input = elemento('input', 'campo') as HTMLInputElement;
  input.id = 'nome-nota';
  input.required = true;
  input.placeholder = 'Ex.: Farmacologia básica';
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
    if (nome.includes('/') || nome.includes('\\')) {
      erro.textContent = 'Digite apenas o nome; a pasta já está preenchida.';
      erro.hidden = false;
      return;
    }
    if (!nome.endsWith('.md')) nome += '.md';
    const caminho = `${destino}${nome}`;
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
      arvore = construirArvore(caminhos);
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
      pastaRetorno = pastaAtual;
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
    arvore = construirArvore(caminhos);
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
    arvore = construirArvore(caminhos);
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

  const extensoes = [
    compartimentoNumeros.of(modoInicial === 'preview' ? [] : lineNumbers()),
    history(),
    markdown(),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    preservarQuebras(nota.texto, nota.eol),
    compartimentoTema.of(realceMarkdown(paletaEfetiva(preferenciaTema, sistemaEscuro()))),
    compartimentoPreview.of(modoInicial === 'preview' ? livePreview() : []),
    EditorView.lineWrapping,
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
    if (editor) configurarLivePreview(editor, compartimentoPreview, true);
    editor?.dispatch({ effects: compartimentoNumeros.reconfigure([]) });
    editorHost.dataset.modo = 'preview';
    editorHost.hidden = false;
    leituraHost.hidden = true;
    marcarModo(preview);
    editor?.focus();
  };
  const ativarLeitura = (secaoAlvo = ''): void => {
    if (!editor || !nota) return;
    try {
      const texto = textoExato(editor.state);
      leituraHost.innerHTML = renderizarMarkdown(texto, { caminhos, caminhoAtual: nota.caminho });
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
  listarNotasComSha(token)
    .then((resultado) => {
      caminhos = resultado.caminhos;
      blobs = resultado.blobs;
      treeSha = resultado.treeSha;
      arvore = construirArvore(caminhos);
      lateral?.atualizarArvore(arvore);
      mostrarLista();
    })
    .catch((erro) => {
      encerrarSessao();
      mostrarEntrada(erroSeguro(erro));
    });
} else {
  mostrarEntrada();
}
