import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import MarkdownIt from 'markdown-it';
import { codificarBase64, codificarEstado } from './bytes';
import {
  CaminhoExistente,
  ConflitoGitHub,
  conflitoParaTela,
  criarNota,
  lerNota,
  listarNotas,
  PASTA,
  salvarNota,
  type NotaRemota,
} from './github';
import { mesmoTexto, preservarQuebras, textoExato } from './NotaBytes';
import { guardarToken, lerToken, sair } from './session';
import './style.css';

const raiz = document.querySelector<HTMLDivElement>('#app') as HTMLDivElement;
if (!raiz) throw new Error('Contêiner principal ausente.');

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });
let token = lerToken(sessionStorage);
let caminhos: string[] = [];
let nota: NotaRemota | null = null;
let editor: EditorView | null = null;
let estadoSalvo: EditorState | null = null;
let salvando = false;

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
  raiz.replaceChildren();
}

function botaoSair(): HTMLButtonElement {
  const botao = elemento('button', 'botao botao-sutil', 'Sair');
  botao.type = 'button';
  botao.addEventListener('click', () => {
    sair(sessionStorage);
    token = null;
    caminhos = [];
    nota = null;
    mostrarEntrada();
  });
  return botao;
}

function cabecalho(titulo: string, subtitulo?: string): HTMLElement {
  const header = elemento('header', 'cabecalho');
  const marca = elemento('div', 'marca');
  marca.append(elemento('span', 'marca-sinal', '06'), elemento('strong', '', titulo));
  if (subtitulo) marca.append(elemento('span', 'caminho', subtitulo));
  header.append(marca, botaoSair());
  return header;
}

function mostrarEntrada(mensagem = ''): void {
  limpar();
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
      caminhos = await listarNotas(valor);
      guardarToken(sessionStorage, valor);
      token = valor;
      input.value = '';
      mostrarLista();
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
      'Máquina compartilhada: o token fica só nesta aba. Feche a aba ao terminar.',
    ),
  );
  pagina.append(painel);
  raiz.append(pagina);
  input.focus();
}

async function abrirNota(caminho: string): Promise<void> {
  if (!token) return mostrarEntrada();
  mostrarCarregando(caminho);
  try {
    nota = await lerNota(token, caminho);
    mostrarNota();
  } catch (erro) {
    mostrarLista(erroSeguro(erro));
  }
}

function mostrarCarregando(caminho: string): void {
  limpar();
  const pagina = elemento('main', 'app-shell');
  pagina.append(cabecalho('Conhecimento', caminho));
  const carregando = elemento('section', 'estado-central');
  carregando.append(elemento('div', 'spinner'), elemento('p', '', 'Abrindo nota…'));
  pagina.append(carregando);
  raiz.append(pagina);
}

function nomeVisivel(caminho: string): string {
  return caminho.slice(PASTA.length).replace(/\.md$/, '');
}

function mostrarLista(mensagem = ''): void {
  limpar();
  const pagina = elemento('main', 'app-shell');
  pagina.append(cabecalho('Conhecimento', `${caminhos.length} notas`));
  const corpo = elemento('section', 'lista-corpo');
  const topo = elemento('div', 'lista-topo');
  const titulos = elemento('div');
  titulos.append(
    elemento('p', 'sobretitulo', '06_CONHECIMENTO'),
    elemento('h1', '', 'Escolha o que estudar'),
  );
  const nova = elemento('button', 'botao botao-primario', 'Nova nota');
  nova.type = 'button';
  nova.addEventListener('click', mostrarCriacao);
  topo.append(titulos, nova);
  const busca = elemento('input', 'campo busca') as HTMLInputElement;
  busca.type = 'search';
  busca.placeholder = 'Filtrar pelo nome do arquivo';
  busca.autocomplete = 'off';
  busca.setAttribute('aria-label', 'Filtrar notas por nome');
  const feedback = elemento('p', 'mensagem erro', mensagem);
  feedback.hidden = !mensagem;
  const contador = elemento('p', 'contador');
  const lista = elemento('div', 'lista-notas');

  const renderizar = (): void => {
    const termo = busca.value.toLocaleLowerCase('pt-BR');
    const filtrados = caminhos.filter((caminho) =>
      nomeVisivel(caminho).toLocaleLowerCase('pt-BR').includes(termo),
    );
    contador.textContent = `${filtrados.length} ${filtrados.length === 1 ? 'nota' : 'notas'}`;
    lista.replaceChildren();
    if (filtrados.length === 0) {
      lista.append(elemento('p', 'vazio', 'Nenhuma nota corresponde a esse nome.'));
      return;
    }
    for (const caminho of filtrados) {
      const item = elemento('button', 'item-nota');
      item.type = 'button';
      item.append(
        elemento('span', 'item-marca', 'MD'),
        elemento('span', 'item-nome', nomeVisivel(caminho)),
        elemento('span', 'item-seta', '→'),
      );
      item.addEventListener('click', () => void abrirNota(caminho));
      lista.append(item);
    }
  };
  busca.addEventListener('input', renderizar);
  corpo.append(topo, busca, feedback, contador, lista);
  pagina.append(corpo);
  raiz.append(pagina);
  renderizar();
  busca.focus();
}

function mostrarCriacao(): void {
  if (!token) return mostrarEntrada();
  const dialogo = elemento('dialog', 'dialogo');
  const form = elemento('form', 'dialogo-conteudo');
  form.method = 'dialog';
  form.append(
    elemento('p', 'sobretitulo', 'NOVA NOTA'),
    elemento('h2', '', 'Dê um nome ao arquivo'),
    elemento('p', 'dialogo-texto', 'A nota será criada vazia dentro de 06_Conhecimento.'),
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
    let nome = input.value;
    if (!nome.endsWith('.md')) nome += '.md';
    const caminho = `${PASTA}${nome}`;
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
      nota = {
        caminho,
        sha: resultado.sha,
        texto: '',
        tinhaBom: false,
        somenteLeitura: false,
        eol: 'lf',
      };
      dialogo.close();
      mostrarNota();
    } catch (falha) {
      erro.textContent =
        falha instanceof CaminhoExistente ? falha.message : erroSeguro(falha);
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

function mostrarNota(): void {
  if (!nota || !token) return mostrarEntrada();
  limpar();
  const pagina = elemento('main', 'app-shell nota-shell');
  const header = cabecalho('Conhecimento', nota.caminho);
  const voltar = elemento('button', 'botao botao-sutil', '← Lista');
  voltar.type = 'button';
  voltar.addEventListener('click', () => {
    if (temAlteracoes() && !window.confirm('Descartar as alterações não gravadas?')) return;
    mostrarLista();
  });
  header.insertBefore(voltar, header.firstChild);
  pagina.append(header);

  const barra = elemento('section', 'barra-nota');
  const modos = elemento('div', 'modos');
  const fonte = elemento('button', 'modo ativo', 'Fonte');
  const leitura = elemento('button', 'modo', 'Leitura');
  fonte.type = leitura.type = 'button';
  modos.append(fonte, leitura);
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
  const leituraHost = elemento('article', 'leitura-markdown');
  leituraHost.hidden = true;
  area.append(editorHost, leituraHost);
  pagina.append(area);
  raiz.append(pagina);

  const atualizarEstado = (): void => {
    if (!editor || !estadoSalvo) return;
    const alterado = !mesmoTexto(editor.state, estadoSalvo);
    estado.textContent = alterado ? 'Alterações não gravadas' : 'Salvo';
    estado.classList.toggle('alterado', alterado);
  };

  const extensoes = [
    lineNumbers(),
    history(),
    markdown(),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    preservarQuebras(nota.texto, nota.eol),
    EditorView.lineWrapping,
    EditorView.updateListener.of((atualizacao) => {
      if (atualizacao.docChanged) atualizarEstado();
    }),
    EditorView.theme({
      '&': { height: '100%' },
      '.cm-scroller': { overflow: 'auto' },
      '.cm-content': { padding: '24px 0 120px' },
      '.cm-line': { padding: '0 28px' },
      '.cm-gutters': { backgroundColor: '#f8f5ee', border: 'none' },
    }),
  ];
  if (nota.somenteLeitura) extensoes.push(EditorView.editable.of(false));
  const estadoInicial = EditorState.create({ doc: nota.texto, extensions: extensoes });
  editor = new EditorView({ state: estadoInicial, parent: editorHost });
  estadoSalvo = editor.state;

  const ativarFonte = (): void => {
    editorHost.hidden = false;
    leituraHost.hidden = true;
    fonte.classList.add('ativo');
    leitura.classList.remove('ativo');
    editor?.focus();
  };
  const ativarLeitura = (): void => {
    if (!editor) return;
    try {
      leituraHost.innerHTML = md.render(textoExato(editor.state));
      editorHost.hidden = true;
      leituraHost.hidden = false;
      leitura.classList.add('ativo');
      fonte.classList.remove('ativo');
    } catch (erro) {
      window.alert(erroSeguro(erro));
    }
  };
  fonte.addEventListener('click', ativarFonte);
  leitura.addEventListener('click', ativarLeitura);

  salvar.addEventListener('click', async () => {
    if (!editor || !nota || salvando || nota.somenteLeitura) return;
    salvando = true;
    salvar.disabled = true;
    salvar.textContent = 'Salvando…';
    try {
      const content = codificarEstado(editor.state, nota.tinhaBom, nota.somenteLeitura);
      const resultado = await salvarNota(token as string, nota.caminho, content, nota.sha);
      nota.sha = resultado.sha;
      estadoSalvo = editor.state;
      atualizarEstado();
    } catch (erro) {
      if (erro instanceof ConflitoGitHub) mostrarConflito();
      else window.alert(erroSeguro(erro));
    } finally {
      salvando = false;
      salvar.disabled = nota.somenteLeitura;
      salvar.textContent = 'Salvar';
    }
  });
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
  mostrarCarregando('Carregando lista…');
  listarNotas(token)
    .then((resultado) => {
      caminhos = resultado;
      mostrarLista();
    })
    .catch((erro) => {
      sair(sessionStorage);
      token = null;
      mostrarEntrada(erroSeguro(erro));
    });
} else {
  mostrarEntrada();
}
