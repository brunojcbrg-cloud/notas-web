export const LIMITE_INATIVIDADE_MS = 15 * 60 * 1000;
export const LIMITE_OCULTA_MS = 5 * 60 * 1000;

type Temporizador = ReturnType<typeof setTimeout>;
type Agendar = (acao: () => void, atraso: number) => Temporizador;
type Cancelar = (id: Temporizador) => void;

export class BloqueioInatividade {
  private ocioso: Temporizador | null = null;
  private oculta: Temporizador | null = null;
  private ativo = false;

  constructor(
    private readonly aoTrancar: () => boolean | void | Promise<boolean | void>,
    // Embrulhados de proposito: como propriedade de classe, `this.agendar(...)`
    // chamaria o nativo tendo a instancia como dono, e o navegador recusa com
    // "Illegal invocation". O relogio falso dos testes nao impoe essa regra.
    private readonly agendar: Agendar = (acao, atraso) => setTimeout(acao, atraso),
    private readonly cancelar: Cancelar = (id) => clearTimeout(id),
  ) {}

  iniciar(): void {
    this.ativo = true;
    this.rearmarOcioso();
  }

  parar(): void {
    this.ativo = false;
    this.limparOcioso();
    this.limparOculta();
  }

  interagir(): void {
    if (!this.ativo) return;
    this.rearmarOcioso();
  }

  visibilidadeMudou(oculta: boolean): void {
    if (!this.ativo) return;
    this.limparOculta();
    if (oculta) {
      this.oculta = this.agendar(() => this.trancar(), LIMITE_OCULTA_MS);
    } else {
      this.rearmarOcioso();
    }
  }

  private rearmarOcioso(): void {
    this.limparOcioso();
    this.ocioso = this.agendar(() => this.trancar(), LIMITE_INATIVIDADE_MS);
  }

  private limparOcioso(): void {
    if (this.ocioso !== null) this.cancelar(this.ocioso);
    this.ocioso = null;
  }

  private limparOculta(): void {
    if (this.oculta !== null) this.cancelar(this.oculta);
    this.oculta = null;
  }

  private async trancar(): Promise<void> {
    if (!this.ativo) return;
    this.parar();
    try {
      if (await this.aoTrancar() === false) this.iniciar();
    } catch {
      this.iniciar();
    }
  }
}

export function conectarBloqueio(
  controlador: BloqueioInatividade,
  janela: Window,
  documento: Document,
): () => void {
  const interagir = (): void => controlador.interagir();
  const visibilidade = (): void =>
    controlador.visibilidadeMudou(documento.visibilityState === 'hidden');
  janela.addEventListener('keydown', interagir, true);
  janela.addEventListener('click', interagir, true);
  janela.addEventListener('dragstart', interagir, true);
  janela.addEventListener('scroll', interagir, { capture: true, passive: true });
  documento.addEventListener('visibilitychange', visibilidade);
  controlador.iniciar();
  return () => {
    janela.removeEventListener('keydown', interagir, true);
    janela.removeEventListener('click', interagir, true);
    janela.removeEventListener('dragstart', interagir, true);
    janela.removeEventListener('scroll', interagir, true);
    documento.removeEventListener('visibilitychange', visibilidade);
    controlador.parar();
  };
}
