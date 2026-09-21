import { nomeDaNota, pastaDaNota } from './tree';
import { listarCabecalhos } from './markdown';

export interface SugestaoDeNota {
  nome: string;
  caminho: string;
  pasta: string;
}

export interface SugestaoDeCabecalho {
  titulo: string;
  nivel: number;
}

const comparar = new Intl.Collator('pt-BR', { sensitivity: 'base' }).compare;

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR');
}

function faixa(nome: string, busca: string): number {
  if (!busca) return 0;
  const normalizado = normalizar(nome);
  if (normalizado.startsWith(busca)) return 0;
  if (normalizado.includes(busca)) return 1;
  return 2;
}

/**
 * Ordena as notas como o popup deve mostrá-las, sem esconder homônimos.
 *
 * O texto aceito é sempre `nome`, nunca `caminho`: a pasta só explica ao
 * leitor qual homônimo está vendo. A resolução continua sendo a mesma do
 * Obsidian, por nome e com preferência pela pasta da nota aberta.
 */
export function sugerirNotas(
  caminhos: readonly string[],
  caminhoAtual: string,
  digitado: string,
): SugestaoDeNota[] {
  const busca = normalizar(digitado.trim());
  const pastaAtual = pastaDaNota(caminhoAtual);
  return caminhos
    .map((caminho) => ({
      nome: nomeDaNota(caminho),
      caminho,
      pasta: pastaDaNota(caminho),
    }))
    .sort((a, b) => {
      const porFaixa = faixa(a.nome, busca) - faixa(b.nome, busca);
      if (porFaixa) return porFaixa;
      const porPastaAtual = Number(b.pasta === pastaAtual) - Number(a.pasta === pastaAtual);
      if (porPastaAtual) return porPastaAtual;
      return comparar(a.nome, b.nome) || comparar(a.caminho, b.caminho);
    });
}

/** Extrai e ordena os cabeçalhos sem tocar a rede. */
export function sugerirCabecalhos(texto: string, digitado: string): SugestaoDeCabecalho[] {
  const busca = normalizar(digitado.trim());
  return listarCabecalhos(texto)
    .map(({ titulo, nivel }) => ({ titulo, nivel }))
    .sort(
      (a, b) =>
        faixa(a.titulo, busca) - faixa(b.titulo, busca) || comparar(a.titulo, b.titulo),
    );
}
