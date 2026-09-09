import type { EditorState } from '@codemirror/state';
import { textoExato } from './NotaBytes';

export type TipoEol = 'lf' | 'crlf' | 'misto';

export interface NotaDecodificada {
  texto: string;
  tinhaBom: boolean;
  somenteLeitura: boolean;
  eol: TipoEol;
}

const BOM = new Uint8Array([0xef, 0xbb, 0xbf]);

function base64ParaBytes(base64: string): Uint8Array {
  const binario = atob(base64.replace(/\s/g, ''));
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

function bytesParaBase64(bytes: Uint8Array): string {
  const tamanhoBloco = 0x8000;
  let binario = '';
  for (let i = 0; i < bytes.length; i += tamanhoBloco) {
    binario += String.fromCharCode(...bytes.subarray(i, i + tamanhoBloco));
  }
  return btoa(binario);
}

export function temCrIsolado(texto: string): boolean {
  return /\r(?!\n)/.test(texto);
}

export function detectarEol(texto: string): TipoEol {
  const temCrLf = /\r\n/.test(texto);
  const temLf = /(^|[^\r])\n/.test(texto);
  if (temCrLf && temLf) return 'misto';
  if (temCrLf) return 'crlf';
  return 'lf';
}

export function decodificarBase64(base64: string): NotaDecodificada {
  const bytes = base64ParaBytes(base64);
  const tinhaBom =
    bytes.length >= 3 &&
    bytes[0] === BOM[0] &&
    bytes[1] === BOM[1] &&
    bytes[2] === BOM[2];
  const conteudo = tinhaBom ? bytes.subarray(3) : bytes;
  const texto = new TextDecoder('utf-8').decode(conteudo);
  return {
    texto,
    tinhaBom,
    somenteLeitura: temCrIsolado(texto),
    eol: detectarEol(texto),
  };
}

export function codificarBase64(texto: string, incluirBom: boolean): string {
  const conteudo = new TextEncoder().encode(texto);
  if (!incluirBom) return bytesParaBase64(conteudo);
  const completo = new Uint8Array(BOM.length + conteudo.length);
  completo.set(BOM);
  completo.set(conteudo, BOM.length);
  return bytesParaBase64(completo);
}

export function codificarEstado(
  state: EditorState,
  incluirBom: boolean,
  somenteLeitura: boolean,
): string {
  if (somenteLeitura) {
    throw new Error('Nota com CR isolado: salvamento recusado.');
  }
  return codificarBase64(textoExato(state), incluirBom);
}
