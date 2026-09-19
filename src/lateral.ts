import { entradasDaPasta, pastaDaNota, type ArvoreNotas } from './tree';
import type { OrigemMovimento } from './operacoes';

export const CHAVE_LATERAL = 'notas-web.lateral';

export interface EstadoLateral {
  aberta: boolean;
  expandidas: string[];
  largura?: number;
}

export interface ArmazenamentoLateral {
  getItem(chave: string): string | null;
  setItem(chave: string, valor: string): void;
}

export interface Lateral {
  elemento: HTMLElement;
  aberta(): boolean;
  definirAberta(aberta: boolean): void;
  selecionarNota(caminho: string | null): void;
  atualizarArvore(arvore: ArvoreNotas): void;
}

export function lerEstadoLateral(
  storage: ArmazenamentoLateral,
  arvore: ArvoreNotas,
  abertaPadrao = true,
): EstadoLateral {
  const padrao = (): EstadoLateral => ({ aberta: abertaPadrao, expandidas: [] });
  try {
    const valor = storage.getItem(CHAVE_LATERAL);
    if (!valor) return padrao();
    const lido: unknown = JSON.parse(valor);
    if (!lido || typeof lido !== 'object' || Array.isArray(lido)) return padrao();
    const estado = lido as Partial<EstadoLateral>;
    const expandidas = Array.isArray(estado.expandidas)
      ? [...new Set(estado.expandidas.filter(
          (caminho): caminho is string => typeof caminho === 'string' && caminho !== '' && (arvore.notas.length === 0 || arvore.pastas.has(caminho)),
        ))]
      : [];
    const resultado: EstadoLateral = {
      aberta: typeof estado.aberta === 'boolean' ? estado.aberta : abertaPadrao,
      expandidas,
    };
    if (typeof estado.largura === 'number' && Number.isFinite(estado.largura)) {
      resultado.largura = estado.largura;
    }
    return resultado;
  } catch {
    return padrao();
  }
}

export function criarLateral(
  arvoreInicial: ArvoreNotas,
  storage: ArmazenamentoLateral,
  aoAbrirNota: (caminho: string) => void,
  aoAbrirPasta: (caminho: string) => void,
  abertaPadrao = true,
  aoMover?: (origem: OrigemMovimento, destino?: string) => void,
): Lateral {
  let arvore = arvoreInicial;
  const estado = lerEstadoLateral(storage, arvore, abertaPadrao);
  const expandidas = new Set(estado.expandidas);
  let notaSelecionada: string | null = null;
  const pastas = new Map<string, { botao: HTMLButtonElement; filhos: HTMLElement }>();
  const notas = new Map<string, HTMLButtonElement>();
  let menu: HTMLElement | null = null;
  let fecharFora: ((evento: PointerEvent) => void) | null = null;
  let arrastada: OrigemMovimento | null = null;
  let toqueLongo: ReturnType<typeof setTimeout> | null = null;
  let suprimirClique = false;

  const aside = document.createElement('aside');
  aside.className = 'lateral';
  aside.setAttribute('aria-label', 'Explorador de notas');
  const topo = document.createElement('div');
  topo.className = 'lateral-topo';
  const titulo = document.createElement('strong');
  titulo.textContent = '06_Conhecimento';
  const contagem = document.createElement('span');
  contagem.className = 'lateral-total';
  topo.append(titulo, contagem);
  const navegacao = document.createElement('nav');
  navegacao.className = 'lateral-arvore';
  navegacao.setAttribute('aria-label', 'Pastas e notas');
  aside.append(topo, navegacao);

  const fecharMenu = (): void => {
    menu?.remove(); menu = null;
    if (fecharFora) document.removeEventListener('pointerdown', fecharFora, true);
    fecharFora = null;
  };
  const mostrarMenu = (origem: OrigemMovimento, ancora: HTMLElement, x?: number, y?: number): void => {
    fecharMenu();
    const painel = document.createElement('div');
    painel.className = 'lateral-menu';
    painel.setAttribute('role', 'menu');
    for (const [rotulo, acao] of [
      ['Abrir', () => origem.tipo === 'nota' ? aoAbrirNota(origem.caminho) : aoAbrirPasta(origem.caminho)],
      ['Mover para…', () => aoMover?.(origem)],
    ] as const) {
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.setAttribute('role', 'menuitem');
      botao.textContent = rotulo;
      botao.addEventListener('click', () => { fecharMenu(); acao(); });
      painel.append(botao);
    }
    document.body.append(painel);
    const caixa = ancora.getBoundingClientRect();
    painel.style.left = `${Math.min(x ?? caixa.right, window.innerWidth - painel.offsetWidth - 8)}px`;
    painel.style.top = `${Math.min(y ?? caixa.bottom, window.innerHeight - painel.offsetHeight - 8)}px`;
    menu = painel;
    fecharFora = (evento: PointerEvent): void => {
      if (painel.contains(evento.target as Node)) return;
      fecharMenu();
    };
    document.addEventListener('pointerdown', fecharFora, true);
  };

  const gestos = (botao: HTMLButtonElement, origem: OrigemMovimento, destino?: string): void => {
    if (!aoMover) return;
    botao.draggable = true;
    botao.addEventListener('dragstart', (evento) => {
      arrastada = origem;
      evento.dataTransfer?.setData('text/plain', origem.caminho);
      if (evento.dataTransfer) evento.dataTransfer.effectAllowed = 'move';
    });
    botao.addEventListener('dragend', () => { arrastada = null; aside.querySelectorAll('.alvo-mover').forEach((el) => el.classList.remove('alvo-mover')); });
    if (destino !== undefined) {
      botao.addEventListener('dragover', (evento) => {
        if (!arrastada || (arrastada.tipo === 'pasta' && (destino === arrastada.caminho || destino.startsWith(`${arrastada.caminho}/`)))) return;
        evento.preventDefault();
        botao.classList.add('alvo-mover');
      });
      botao.addEventListener('dragleave', () => botao.classList.remove('alvo-mover'));
      botao.addEventListener('drop', (evento) => {
        evento.preventDefault();
        evento.stopPropagation();
        botao.classList.remove('alvo-mover');
        if (arrastada) aoMover(arrastada, destino);
        arrastada = null;
      });
    }
    botao.addEventListener('contextmenu', (evento) => {
      evento.preventDefault();
      mostrarMenu(origem, botao, evento.clientX, evento.clientY);
    });
    botao.addEventListener('touchstart', () => {
      toqueLongo = setTimeout(() => { suprimirClique = true; mostrarMenu(origem, botao); }, 550);
    }, { passive: true });
    for (const tipo of ['touchend', 'touchcancel', 'touchmove']) {
      botao.addEventListener(tipo, () => { if (toqueLongo) clearTimeout(toqueLongo); toqueLongo = null; }, { passive: true });
    }
    botao.addEventListener('click', (evento) => {
      if (!suprimirClique) return;
      evento.stopImmediatePropagation();
      suprimirClique = false;
    }, true);
  };

  if (aoMover) {
    topo.title = 'Solte aqui para mover à pasta principal';
    topo.addEventListener('dragover', (evento) => {
      if (!arrastada) return;
      evento.preventDefault();
      topo.classList.add('alvo-mover');
    });
    topo.addEventListener('dragleave', () => topo.classList.remove('alvo-mover'));
    topo.addEventListener('drop', (evento) => {
      evento.preventDefault();
      topo.classList.remove('alvo-mover');
      if (arrastada) aoMover(arrastada, '');
      arrastada = null;
    });
  }

  const guardar = (): void => {
    try {
      storage.setItem(CHAVE_LATERAL, JSON.stringify({ ...estado, expandidas: [...expandidas] }));
    } catch {
      // Preferências indisponíveis não devem impedir a navegação.
    }
  };

  const refletirPasta = (caminho: string): void => {
    const item = pastas.get(caminho);
    if (!item) return;
    const expandida = expandidas.has(caminho);
    item.botao.setAttribute('aria-expanded', String(expandida));
    item.filhos.hidden = !expandida;
  };

  const renderizar = (): void => {
    fecharMenu();
    pastas.clear();
    notas.clear();
    contagem.textContent = `${arvore.notas.length} notas`;
    let indice = 0;
    const nivel = (caminho: string, profundidade: number): HTMLElement => {
      const grupo = document.createElement('div');
      grupo.className = 'lateral-nivel';
      for (const entrada of entradasDaPasta(arvore, caminho)) {
        if (entrada.tipo === 'nota') {
          const botao = document.createElement('button');
          botao.type = 'button';
          botao.className = 'lateral-item lateral-nota';
          botao.dataset.caminho = entrada.caminho;
          botao.dataset.nivel = String(profundidade);
          botao.title = entrada.nome;
          botao.style.setProperty('--nivel-lateral', String(profundidade));
          const simbolo = document.createElement('span');
          simbolo.className = 'lateral-simbolo';
          simbolo.textContent = '·';
          const nome = document.createElement('span');
          nome.className = 'lateral-nome';
          nome.textContent = entrada.nome;
          botao.append(simbolo, nome);
          gestos(botao, { tipo: 'nota', caminho: entrada.caminho });
          if (aoMover) {
            const mais = document.createElement('span');
            mais.className = 'lateral-mais';
            mais.textContent = '⋯';
            mais.setAttribute('role', 'button');
            mais.setAttribute('tabindex', '0');
            mais.setAttribute('aria-label', `Ações para ${entrada.nome}`);
            mais.addEventListener('click', (evento) => { evento.stopPropagation(); mostrarMenu({ tipo: 'nota', caminho: entrada.caminho }, mais); });
            mais.addEventListener('keydown', (evento) => { if (evento.key === 'Enter' || evento.key === ' ') { evento.preventDefault(); mostrarMenu({ tipo: 'nota', caminho: entrada.caminho }, mais); } });
            botao.append(mais);
          }
          botao.addEventListener('click', () => aoAbrirNota(entrada.caminho));
          notas.set(entrada.caminho, botao);
          grupo.append(botao);
          continue;
        }
        const botao = document.createElement('button');
        botao.type = 'button';
        botao.className = 'lateral-item lateral-pasta';
        botao.dataset.caminho = entrada.caminho;
        botao.dataset.nivel = String(profundidade);
        botao.title = entrada.nome;
        botao.style.setProperty('--nivel-lateral', String(profundidade));
        const id = `lateral-grupo-${indice++}`;
        botao.setAttribute('aria-controls', id);
        const seta = document.createElement('span');
        seta.className = 'lateral-seta';
        seta.setAttribute('aria-hidden', 'true');
        seta.textContent = '›';
        const nome = document.createElement('span');
        nome.className = 'lateral-nome';
        nome.textContent = entrada.nome;
        const total = document.createElement('span');
        total.className = 'lateral-contagem';
        total.textContent = String(entrada.totalNotas);
        botao.append(seta, nome, total);
        gestos(botao, { tipo: 'pasta', caminho: entrada.caminho }, entrada.caminho);
        if (aoMover) {
          const mais = document.createElement('span');
          mais.className = 'lateral-mais';
          mais.textContent = '⋯';
          mais.setAttribute('role', 'button');
          mais.setAttribute('tabindex', '0');
          mais.setAttribute('aria-label', `Ações para ${entrada.nome}`);
          mais.addEventListener('click', (evento) => { evento.stopPropagation(); mostrarMenu({ tipo: 'pasta', caminho: entrada.caminho }, mais); });
          mais.addEventListener('keydown', (evento) => { if (evento.key === 'Enter' || evento.key === ' ') { evento.preventDefault(); mostrarMenu({ tipo: 'pasta', caminho: entrada.caminho }, mais); } });
          botao.append(mais);
        }
        const filhos = nivel(entrada.caminho, profundidade + 1);
        filhos.id = id;
        pastas.set(entrada.caminho, { botao, filhos });
        botao.addEventListener('click', () => {
          if (expandidas.has(entrada.caminho)) expandidas.delete(entrada.caminho);
          else expandidas.add(entrada.caminho);
          refletirPasta(entrada.caminho);
          guardar();
          aoAbrirPasta(entrada.caminho);
        });
        grupo.append(botao, filhos);
      }
      return grupo;
    };
    navegacao.replaceChildren(nivel('', 0));
    for (const caminho of pastas.keys()) refletirPasta(caminho);
    for (const [caminho, botao] of notas) {
      const ativa = caminho === notaSelecionada;
      botao.classList.toggle('ativa', ativa);
      if (ativa) botao.setAttribute('aria-current', 'page');
    }
  };

  const selecionarNota = (caminho: string | null): void => {
    if (notaSelecionada) {
      const anterior = notas.get(notaSelecionada);
      anterior?.classList.remove('ativa');
      anterior?.removeAttribute('aria-current');
    }
    notaSelecionada = caminho;
    if (!caminho) return;
    const pasta = pastaDaNota(caminho);
    const partes = pasta ? pasta.split('/') : [];
    let mudou = false;
    for (let i = 0; i < partes.length; i += 1) {
      const ancestral = partes.slice(0, i + 1).join('/');
      if (!arvore.pastas.has(ancestral) || expandidas.has(ancestral)) continue;
      expandidas.add(ancestral);
      refletirPasta(ancestral);
      mudou = true;
    }
    const atual = notas.get(caminho);
    atual?.classList.add('ativa');
    atual?.setAttribute('aria-current', 'page');
    if (mudou) guardar();
  };

  renderizar();
  return {
    elemento: aside,
    aberta: () => estado.aberta,
    definirAberta: (aberta) => {
      if (estado.aberta === aberta) return;
      estado.aberta = aberta;
      guardar();
    },
    selecionarNota,
    atualizarArvore: (novaArvore) => {
      const rolagem = navegacao.scrollTop;
      arvore = novaArvore;
      for (const caminho of expandidas) if (!arvore.pastas.has(caminho)) expandidas.delete(caminho);
      renderizar();
      selecionarNota(notaSelecionada);
      navegacao.scrollTop = rolagem;
      guardar();
    },
  };
}
