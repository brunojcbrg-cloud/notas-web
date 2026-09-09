import { PASTA } from './github';

export interface NotaArvore {
  tipo: 'nota';
  nome: string;
  caminho: string;
  pasta: string;
}

export interface PastaArvore {
  tipo: 'pasta';
  nome: string;
  caminho: string;
  pastas: Map<string, PastaArvore>;
  notas: NotaArvore[];
  totalNotas: number;
}

export interface ArvoreNotas {
  raiz: PastaArvore;
  pastas: Map<string, PastaArvore>;
  notas: NotaArvore[];
  totalPastas: number;
  profundidadeMaxima: number;
}

export type EntradaPasta = PastaArvore | NotaArvore;

const comparar = (a: string, b: string): number =>
  a.localeCompare(b, 'pt-BR', { sensitivity: 'base' });

export function nomeDaNota(caminho: string): string {
  const nome = caminho.split('/').at(-1) ?? caminho;
  return nome.replace(/\.md$/i, '');
}

export function pastaDaNota(caminho: string): string {
  const relativo = caminho.startsWith(PASTA) ? caminho.slice(PASTA.length) : caminho;
  const partes = relativo.split('/');
  partes.pop();
  return partes.join('/');
}

function novaPasta(nome: string, caminho: string): PastaArvore {
  return {
    tipo: 'pasta',
    nome,
    caminho,
    pastas: new Map(),
    notas: [],
    totalNotas: 0,
  };
}

export function construirArvore(caminhos: readonly string[]): ArvoreNotas {
  const raiz = novaPasta('06_Conhecimento', '');
  const pastas = new Map<string, PastaArvore>([['', raiz]]);
  const notas: NotaArvore[] = [];
  let profundidadeMaxima = 0;

  for (const caminho of caminhos) {
    if (!caminho.startsWith(PASTA) || !caminho.toLowerCase().endsWith('.md')) continue;
    const partes = caminho.slice(PASTA.length).split('/');
    const arquivo = partes.pop();
    if (!arquivo) continue;
    let atual = raiz;
    const acumulado: string[] = [];
    for (const segmento of partes) {
      acumulado.push(segmento);
      const pasta = acumulado.join('/');
      let filha = atual.pastas.get(segmento);
      if (!filha) {
        filha = novaPasta(segmento, pasta);
        atual.pastas.set(segmento, filha);
        pastas.set(pasta, filha);
      }
      atual = filha;
    }
    profundidadeMaxima = Math.max(profundidadeMaxima, partes.length);
    const nota: NotaArvore = {
      tipo: 'nota',
      nome: arquivo.replace(/\.md$/i, ''),
      caminho,
      pasta: partes.join('/'),
    };
    atual.notas.push(nota);
    notas.push(nota);
  }

  const contar = (pasta: PastaArvore): number => {
    pasta.totalNotas =
      pasta.notas.length +
      [...pasta.pastas.values()].reduce((total, filha) => total + contar(filha), 0);
    return pasta.totalNotas;
  };
  contar(raiz);

  return {
    raiz,
    pastas,
    notas,
    totalPastas: Math.max(0, pastas.size - 1),
    profundidadeMaxima,
  };
}

export function entradasDaPasta(arvore: ArvoreNotas, caminho = ''): EntradaPasta[] {
  const pasta = arvore.pastas.get(caminho) ?? arvore.raiz;
  const filhas = [...pasta.pastas.values()].sort((a, b) => comparar(a.nome, b.nome));
  const notas = [...pasta.notas].sort((a, b) => comparar(a.nome, b.nome));
  return [...filhas, ...notas];
}

export function filtrarNotas(arvore: ArvoreNotas, termo: string): NotaArvore[] {
  const busca = termo.trim().toLocaleLowerCase('pt-BR');
  if (!busca) return [];
  return arvore.notas
    .filter((nota) => nota.nome.toLocaleLowerCase('pt-BR').includes(busca))
    .sort((a, b) => comparar(a.caminho, b.caminho));
}

export function trilhaDaPasta(caminho: string): Array<{ nome: string; caminho: string }> {
  const partes = caminho ? caminho.split('/') : [];
  const trilha = [{ nome: '06_Conhecimento', caminho: '' }];
  for (let i = 0; i < partes.length; i += 1) {
    trilha.push({ nome: partes[i], caminho: partes.slice(0, i + 1).join('/') });
  }
  return trilha;
}
