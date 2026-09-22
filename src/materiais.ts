import { decodificarBase64 } from './bytes';
import { branchAtual, repoAtual, type Fetcher } from './github';
import type { ArvoreNotas, NotaArvore, PastaArvore } from './tree';

export const CAMINHO_MANIFESTO = '05_Sistema/notas-web/materiais.json';
export const CHAVE_LATERAL_MATERIAIS = 'notas-web.lateral-materiais';
export const LIMITE_DOWNLOAD_DIRETO = 100_000_000;
const PRAZO_ATUALIZACAO_MS = 7 * 24 * 60 * 60 * 1000;

export type TipoMaterial = 'pdf' | 'html';

export interface Material {
  id: string;
  name: string;
  size: number;
  modifiedTime: string;
  caminho: string;
  // Ausente no manifesto versao 1 (so PDF): normalizado pela extensao do
  // nome em analisarManifesto, nunca lido de confianca do JSON de entrada.
  tipo: TipoMaterial;
}

export interface ManifestoMateriais {
  versao: 1 | 2;
  geradoEm: string;
  arquivos: Material[];
}

export type EstadoMateriais =
  | { tipo: 'pronto'; manifesto: ManifestoMateriais; antigo: boolean }
  | { tipo: 'ausente' | 'invalido' | 'indisponivel'; mensagem: string };

const EXTENSAO_VALIDA = /\.(pdf|html)$/i;

function extensaoDoNome(nome: string): TipoMaterial | null {
  const m = EXTENSAO_VALIDA.exec(nome);
  if (!m) return null;
  return m[1].toLowerCase() === 'pdf' ? 'pdf' : 'html';
}

function materialValido(valor: unknown): valor is Omit<Material, 'tipo'> {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return false;
  const item = valor as Partial<Material>;
  if (typeof item.id !== 'string' || !/^[\w-]+$/.test(item.id) ||
      typeof item.name !== 'string' || extensaoDoNome(item.name) === null ||
      typeof item.caminho !== 'string' || typeof item.modifiedTime !== 'string' ||
      typeof item.size !== 'number' || !Number.isSafeInteger(item.size) || item.size < 0) return false;
  const partes = item.caminho.split('/');
  return partes.length >= 2 && partes.every((parte) => parte && parte !== '.' && parte !== '..' && !parte.includes('\\')) &&
    partes.at(-1) === item.name && !Number.isNaN(Date.parse(item.modifiedTime));
}

export function analisarManifesto(valor: unknown, agora = Date.now()): EstadoMateriais {
  const invalido = (): EstadoMateriais => ({ tipo: 'invalido', mensagem: 'Manifesto de materiais inválido ou de versão desconhecida. Gere-o novamente no PC.' });
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return invalido();
  const dados = valor as Partial<ManifestoMateriais>;
  if ((dados.versao !== 1 && dados.versao !== 2) || typeof dados.geradoEm !== 'string' ||
      Number.isNaN(Date.parse(dados.geradoEm)) || !Array.isArray(dados.arquivos) ||
      !dados.arquivos.every(materialValido)) return invalido();
  if (new Set(dados.arquivos.map((item) => (item as Material).caminho)).size !== dados.arquivos.length) return invalido();
  const arquivos = (dados.arquivos as Omit<Material, 'tipo'>[]).map((item) => ({
    ...item,
    tipo: extensaoDoNome(item.name) as TipoMaterial,
  }));
  return {
    tipo: 'pronto',
    manifesto: { ...dados, arquivos } as ManifestoMateriais,
    antigo: agora - Date.parse(dados.geradoEm) > PRAZO_ATUALIZACAO_MS,
  };
}

export async function lerManifestoMateriais(token: string, fetcher: Fetcher = fetch): Promise<EstadoMateriais> {
  try {
    const caminho = CAMINHO_MANIFESTO.split('/').map(encodeURIComponent).join('/');
    const resposta = await fetcher(`https://api.github.com/repos/${repoAtual()}/contents/${caminho}?ref=${branchAtual()}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (resposta.status === 404) return { tipo: 'ausente', mensagem: 'Manifesto ainda não gerado. Rode o gerador no PC e sincronize o vault.' };
    if (!resposta.ok) return { tipo: 'indisponivel', mensagem: 'Não foi possível ler os materiais agora. As notas continuam disponíveis.' };
    const dados = (await resposta.json()) as { content?: unknown };
    if (typeof dados.content !== 'string') return analisarManifesto(null);
    try {
      return analisarManifesto(JSON.parse(decodificarBase64(dados.content).texto));
    } catch {
      return analisarManifesto(null);
    }
  } catch {
    return { tipo: 'indisponivel', mensagem: 'Não foi possível ler os materiais agora. As notas continuam disponíveis.' };
  }
}

function novaPasta(nome: string, caminho: string): PastaArvore {
  return { tipo: 'pasta', nome, caminho, pastas: new Map(), notas: [], totalNotas: 0 };
}

// Devolve o contrato da lateral sem passar por construirArvore ou validarCaminho
// (materiais não moram em 06_Conhecimento/, então a validação de pastaAtual() não se aplica).
export function construirArvoreMateriais(arquivos: readonly Material[]): ArvoreNotas {
  const raiz = novaPasta('Materiais', '');
  const pastas = new Map<string, PastaArvore>([['', raiz]]);
  const notas: NotaArvore[] = [];
  let profundidadeMaxima = 0;
  for (const arquivo of arquivos) {
    const partes = arquivo.caminho.split('/');
    partes.pop();
    let atual = raiz;
    const acumulado: string[] = [];
    for (const segmento of partes) {
      acumulado.push(segmento);
      const caminho = acumulado.join('/');
      let filha = atual.pastas.get(segmento);
      if (!filha) {
        filha = novaPasta(segmento, caminho);
        atual.pastas.set(segmento, filha);
        pastas.set(caminho, filha);
      }
      atual = filha;
    }
    const nota: NotaArvore = { tipo: 'nota', nome: arquivo.name.replace(EXTENSAO_VALIDA, ''), caminho: arquivo.caminho, pasta: partes.join('/') };
    atual.notas.push(nota);
    notas.push(nota);
    profundidadeMaxima = Math.max(profundidadeMaxima, partes.length);
  }
  const contar = (pasta: PastaArvore): number => {
    pasta.totalNotas = pasta.notas.length + [...pasta.pastas.values()].reduce((soma, filha) => soma + contar(filha), 0);
    return pasta.totalNotas;
  };
  contar(raiz);
  return { raiz, pastas, notas, totalPastas: pastas.size - 1, profundidadeMaxima };
}

export function urlAbrir(material: Material): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(material.id)}/view`;
}

export function grandeParaLinkDireto(material: Material): boolean {
  return material.size >= LIMITE_DOWNLOAD_DIRETO;
}

export function urlBaixar(material: Material): string {
  return grandeParaLinkDireto(material)
    ? urlAbrir(material)
    : `https://drive.google.com/uc?export=download&id=${encodeURIComponent(material.id)}`;
}

// Fase 3, §3.5: `drive.google.com/uc?export=download` devolve 403 sem CORS
// em fetch (medido em 21/09 — ver adendo A.2 do handoff de integração).
// `files/{id}?alt=media` manda CORS para XHR autenticado; exige token de
// sessão do Google (escopo drive.readonly, decidido em M0.3).
export function urlApiMedia(material: Material): string {
  return `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(material.id)}?alt=media`;
}

export function tamanhoLegivel(bytes: number): string {
  const unidade = bytes >= 1_000_000_000 ? 'GB' : bytes >= 1_000_000 ? 'MB' : bytes >= 1_000 ? 'KB' : 'B';
  const divisor = unidade === 'GB' ? 1_000_000_000 : unidade === 'MB' ? 1_000_000 : unidade === 'KB' ? 1_000 : 1;
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: unidade === 'B' ? 0 : 1 }).format(bytes / divisor)} ${unidade}`;
}
