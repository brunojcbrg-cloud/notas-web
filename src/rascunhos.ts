export const PREFIXO_RASCUNHO = 'notas-web.rascunho.v1:';

export interface ArmazenamentoRascunhos {
  getItem(chave: string): string | null;
  setItem(chave: string, valor: string): void;
  removeItem(chave: string): void;
  key(indice: number): string | null;
  readonly length: number;
}

export interface RascunhoPersistente {
  versao: 1;
  caminho: string;
  texto: string;
  textoBase: string;
  shaBase: string;
  tinhaBom: boolean;
  somenteLeitura: boolean;
  eol: 'lf' | 'crlf' | 'misto';
  pastaRetorno: string;
  atualizadoEm: number;
}

function chave(caminho: string): string {
  return `${PREFIXO_RASCUNHO}${encodeURIComponent(caminho)}`;
}

function valido(valor: unknown): valor is RascunhoPersistente {
  if (!valor || typeof valor !== 'object') return false;
  const item = valor as Partial<RascunhoPersistente>;
  return item.versao === 1
    && typeof item.caminho === 'string'
    && typeof item.texto === 'string'
    && typeof item.textoBase === 'string'
    && typeof item.shaBase === 'string'
    && typeof item.tinhaBom === 'boolean'
    && typeof item.somenteLeitura === 'boolean'
    && ['lf', 'crlf', 'misto'].includes(item.eol ?? '')
    && typeof item.pastaRetorno === 'string'
    && typeof item.atualizadoEm === 'number';
}

export function guardarRascunho(
  armazenamento: ArmazenamentoRascunhos,
  rascunho: RascunhoPersistente,
): void {
  armazenamento.setItem(chave(rascunho.caminho), JSON.stringify(rascunho));
}

export function lerRascunho(
  armazenamento: ArmazenamentoRascunhos,
  caminho: string,
): RascunhoPersistente | null {
  try {
    const bruto = armazenamento.getItem(chave(caminho));
    if (!bruto) return null;
    const item: unknown = JSON.parse(bruto);
    return valido(item) ? item : null;
  } catch {
    return null;
  }
}

export function listarRascunhos(
  armazenamento: ArmazenamentoRascunhos,
): RascunhoPersistente[] {
  const itens: RascunhoPersistente[] = [];
  for (let indice = 0; indice < armazenamento.length; indice += 1) {
    const itemChave = armazenamento.key(indice);
    if (!itemChave?.startsWith(PREFIXO_RASCUNHO)) continue;
    try {
      const bruto = armazenamento.getItem(itemChave);
      const item: unknown = bruto ? JSON.parse(bruto) : null;
      if (valido(item)) itens.push(item);
    } catch {
      // Entrada corrompida não impede recuperar as demais.
    }
  }
  return itens.sort((a, b) => b.atualizadoEm - a.atualizadoEm);
}

export function apagarRascunho(
  armazenamento: ArmazenamentoRascunhos,
  caminho: string,
): void {
  armazenamento.removeItem(chave(caminho));
}

export const ATRASO_AUTOSAVE_MS = 5_000;

type Temporizador = ReturnType<typeof setTimeout>;
type Agendar = (acao: () => void, atraso: number) => Temporizador;
type Cancelar = (id: Temporizador) => void;

export class AgendadorAutosave {
  private temporizador: Temporizador | null = null;

  constructor(
    private readonly salvar: () => Promise<boolean>,
    private readonly agendar: Agendar = (acao, atraso) => setTimeout(acao, atraso),
    private readonly cancelar: Cancelar = (id) => clearTimeout(id),
  ) {}

  alterou(): void {
    this.cancelarPendente();
    this.temporizador = this.agendar(() => {
      this.temporizador = null;
      void this.salvar();
    }, ATRASO_AUTOSAVE_MS);
  }

  salvarAgora(): Promise<boolean> {
    this.cancelarPendente();
    return this.salvar();
  }

  parar(): void {
    this.cancelarPendente();
  }

  private cancelarPendente(): void {
    if (this.temporizador !== null) this.cancelar(this.temporizador);
    this.temporizador = null;
  }
}

export async function salvarAntesDeTrancar(
  persistir: () => boolean,
  salvar: () => Promise<boolean>,
  trancar: () => void,
): Promise<boolean> {
  if (!persistir()) return false;
  try {
    await salvar();
  } catch {
    // A segurança vence: o rascunho já está persistido e a sessão deve trancar.
  } finally {
    trancar();
  }
  return true;
}
