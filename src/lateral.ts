import { entradasDaPasta, pastaDaNota, type ArvoreNotas } from './tree';

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
): Lateral {
  let arvore = arvoreInicial;
  const estado = lerEstadoLateral(storage, arvore, abertaPadrao);
  const expandidas = new Set(estado.expandidas);
  let notaSelecionada: string | null = null;
  const pastas = new Map<string, { botao: HTMLButtonElement; filhos: HTMLElement }>();
  const notas = new Map<string, HTMLButtonElement>();

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
