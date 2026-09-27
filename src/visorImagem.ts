/**
 * Visor de imagem em tela cheia com zoom (pedido do Bruno em 27/09: legendas
 * de anatomia ficam ilegíveis na largura da nota). Mesmo comportamento nos
 * três clientes; a matemática espelha `VisorDeImagemMath.kt` do celular.
 *
 * A web já tem a imagem em resolução original no `<img>` (carregada uma vez
 * por `hidratarAnexos`/`imagemDoEmbed`), então o visor reaproveita o mesmo
 * `src` em vez de buscar de novo.
 */

export const ZOOM_MINIMO = 1;
export const ZOOM_MAXIMO = 8;
export const ZOOM_DUPLO_TOQUE = 2.5;

export interface TransformacaoDeImagem {
  escala: number;
  deslocamentoX: number;
  deslocamentoY: number;
}

export const TRANSFORMACAO_INICIAL: TransformacaoDeImagem = { escala: ZOOM_MINIMO, deslocamentoX: 0, deslocamentoY: 0 };

export function limitarEscala(escala: number): number {
  return Math.min(ZOOM_MAXIMO, Math.max(ZOOM_MINIMO, escala));
}

/** Igual ao Kotlin: em repouso (escala mínima) não há o que arrastar. */
export function limiteDeArrasto(escala: number, tamanhoDoEixo: number): number {
  return escala <= ZOOM_MINIMO ? 0 : ((escala - ZOOM_MINIMO) * tamanhoDoEixo) / 2;
}

export function limitarEixo(valor: number, escala: number, tamanhoDoEixo: number): number {
  const limite = limiteDeArrasto(escala, tamanhoDoEixo);
  return Math.min(limite, Math.max(-limite, valor));
}

/**
 * Aplica um passo de zoom (pinça ou roda do mouse) + arrasto sobre a
 * transformação atual, mantendo o ponto sob o centroide/cursor fixo na tela.
 * Mesma dedução de `aplicarGestoDePincaEArrasto` no Kotlin.
 */
export function aplicarZoomEArrasto(
  atual: TransformacaoDeImagem,
  centroideX: number,
  centroideY: number,
  arrastoX: number,
  arrastoY: number,
  fatorDeZoom: number,
  larguraContainer: number,
  alturaContainer: number,
): TransformacaoDeImagem {
  const novaEscala = limitarEscala(atual.escala * fatorDeZoom);
  const centroX = larguraContainer / 2;
  const centroY = alturaContainer / 2;
  const pontoConteudoX = (centroideX - centroX - atual.deslocamentoX) / atual.escala;
  const pontoConteudoY = (centroideY - centroY - atual.deslocamentoY) / atual.escala;
  const novoXBruto = centroideX - centroX - pontoConteudoX * novaEscala + arrastoX;
  const novoYBruto = centroideY - centroY - pontoConteudoY * novaEscala + arrastoY;
  return {
    escala: novaEscala,
    deslocamentoX: limitarEixo(novoXBruto, novaEscala, larguraContainer),
    deslocamentoY: limitarEixo(novoYBruto, novaEscala, alturaContainer),
  };
}

/** Duplo toque/clique alterna entre 1× (recentralizado) e 2,5× focado no ponto. */
export function alternarZoomNoDuploToque(
  atual: TransformacaoDeImagem,
  toqueX: number,
  toqueY: number,
  larguraContainer: number,
  alturaContainer: number,
): TransformacaoDeImagem {
  if (atual.escala > ZOOM_MINIMO) return TRANSFORMACAO_INICIAL;
  const centroX = larguraContainer / 2;
  const centroY = alturaContainer / 2;
  const novoXBruto = -(toqueX - centroX) * (ZOOM_DUPLO_TOQUE - ZOOM_MINIMO);
  const novoYBruto = -(toqueY - centroY) * (ZOOM_DUPLO_TOQUE - ZOOM_MINIMO);
  return {
    escala: ZOOM_DUPLO_TOQUE,
    deslocamentoX: limitarEixo(novoXBruto, ZOOM_DUPLO_TOQUE, larguraContainer),
    deslocamentoY: limitarEixo(novoYBruto, ZOOM_DUPLO_TOQUE, alturaContainer),
  };
}

function elemento<K extends keyof HTMLElementTagNameMap>(tag: K, classe?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  return el;
}

const MARCADOR_HISTORICO = { visorImagem: true } as const;

/**
 * Abre o visor sobre `document.body`. Fecha com Esc, com o botão, ou com o
 * "voltar" do navegador — que não deve sair da nota, só fechar o visor: por
 * isso a abertura empurra uma entrada própria no histórico.
 */
export function abrirVisorDeImagem(src: string, alt = ''): void {
  const fundo = elemento('div', 'visor-imagem-fundo');
  const corpo = elemento('div', 'visor-imagem-corpo');
  const img = elemento('img', 'visor-imagem-img');
  img.src = src;
  img.alt = alt;
  img.draggable = false;
  const botaoFechar = elemento('button', 'visor-imagem-fechar');
  botaoFechar.type = 'button';
  botaoFechar.setAttribute('aria-label', 'Fechar');
  botaoFechar.textContent = '✕';

  let transformacao = TRANSFORMACAO_INICIAL;
  let fechado = false;

  function aplicar(): void {
    img.style.transform = `translate(${transformacao.deslocamentoX}px, ${transformacao.deslocamentoY}px) scale(${transformacao.escala})`;
  }

  function fechar(): void {
    if (fechado) return;
    fechado = true;
    window.removeEventListener('keydown', aoTeclar);
    window.removeEventListener('popstate', aoVoltar);
    fundo.remove();
    if (history.state?.visorImagem) history.back();
  }

  function aoTeclar(evento: KeyboardEvent): void {
    if (evento.key === 'Escape') fechar();
  }

  function aoVoltar(): void {
    fechar();
  }

  botaoFechar.addEventListener('click', fechar);
  fundo.addEventListener('click', (evento) => {
    if (evento.target === fundo) fechar();
  });
  window.addEventListener('keydown', aoTeclar);
  window.addEventListener('popstate', aoVoltar);
  history.pushState(MARCADOR_HISTORICO, '');

  // Roda do mouse, com ou sem Ctrl: as duas ligam zoom (pedido explícito).
  corpo.addEventListener(
    'wheel',
    (evento) => {
      evento.preventDefault();
      const retangulo = corpo.getBoundingClientRect();
      const fator = evento.deltaY < 0 ? 1.15 : 1 / 1.15;
      transformacao = aplicarZoomEArrasto(
        transformacao,
        evento.clientX - retangulo.left,
        evento.clientY - retangulo.top,
        0,
        0,
        fator,
        retangulo.width,
        retangulo.height,
      );
      aplicar();
    },
    { passive: false },
  );

  // Ponteiros: um dedo/botão arrasta, dois dedos dão pinça (zoom + pan).
  const ponteirosAtivos = new Map<number, { x: number; y: number }>();
  let distanciaAnterior: number | null = null;
  let centroAnterior: { x: number; y: number } | null = null;
  let ultimoToque = 0;

  function centroDosPonteiros(): { x: number; y: number } {
    const pontos = [...ponteirosAtivos.values()];
    const soma = pontos.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    return { x: soma.x / pontos.length, y: soma.y / pontos.length };
  }

  function distanciaEntrePonteiros(): number {
    const pontos = [...ponteirosAtivos.values()];
    if (pontos.length < 2) return 0;
    const [a, b] = pontos;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  corpo.addEventListener('pointerdown', (evento) => {
    corpo.setPointerCapture(evento.pointerId);
    ponteirosAtivos.set(evento.pointerId, { x: evento.clientX, y: evento.clientY });
    distanciaAnterior = ponteirosAtivos.size >= 2 ? distanciaEntrePonteiros() : null;
    centroAnterior = ponteirosAtivos.size >= 2 ? centroDosPonteiros() : { x: evento.clientX, y: evento.clientY };
  });

  corpo.addEventListener('pointermove', (evento) => {
    if (!ponteirosAtivos.has(evento.pointerId)) return;
    ponteirosAtivos.set(evento.pointerId, { x: evento.clientX, y: evento.clientY });
    const retangulo = corpo.getBoundingClientRect();
    const centro = centroDosPonteiros();

    if (ponteirosAtivos.size >= 2) {
      const distancia = distanciaEntrePonteiros();
      const fator = distanciaAnterior && distanciaAnterior > 0 ? distancia / distanciaAnterior : 1;
      const arrastoX = centroAnterior ? centro.x - centroAnterior.x : 0;
      const arrastoY = centroAnterior ? centro.y - centroAnterior.y : 0;
      transformacao = aplicarZoomEArrasto(
        transformacao,
        centro.x - retangulo.left,
        centro.y - retangulo.top,
        arrastoX,
        arrastoY,
        fator,
        retangulo.width,
        retangulo.height,
      );
      distanciaAnterior = distancia;
      centroAnterior = centro;
      aplicar();
    } else if (ponteirosAtivos.size === 1 && centroAnterior) {
      const arrastoX = centro.x - centroAnterior.x;
      const arrastoY = centro.y - centroAnterior.y;
      transformacao = aplicarZoomEArrasto(
        transformacao,
        centro.x - retangulo.left,
        centro.y - retangulo.top,
        arrastoX,
        arrastoY,
        1,
        retangulo.width,
        retangulo.height,
      );
      centroAnterior = centro;
      aplicar();
    }
  });

  function soltarPonteiro(evento: PointerEvent): void {
    ponteirosAtivos.delete(evento.pointerId);
    distanciaAnterior = null;
    centroAnterior = ponteirosAtivos.size === 1 ? centroDosPonteiros() : null;
  }
  corpo.addEventListener('pointerup', soltarPonteiro);
  corpo.addEventListener('pointercancel', soltarPonteiro);

  // Duplo toque no touch (dois pointerup rápidos) e duplo clique no mouse.
  function aoDuploToque(x: number, y: number): void {
    const retangulo = corpo.getBoundingClientRect();
    transformacao = alternarZoomNoDuploToque(transformacao, x - retangulo.left, y - retangulo.top, retangulo.width, retangulo.height);
    aplicar();
  }
  corpo.addEventListener('dblclick', (evento) => aoDuploToque(evento.clientX, evento.clientY));
  corpo.addEventListener('pointerup', (evento) => {
    const agora = performance.now();
    if (agora - ultimoToque < 300 && ponteirosAtivos.size === 0) {
      aoDuploToque(evento.clientX, evento.clientY);
    }
    ultimoToque = agora;
  });

  corpo.append(img);
  fundo.append(corpo, botaoFechar);
  document.body.append(fundo);
}
