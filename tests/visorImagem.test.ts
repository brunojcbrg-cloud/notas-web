import { describe, expect, it } from 'vitest';
import {
  TRANSFORMACAO_INICIAL,
  ZOOM_DUPLO_TOQUE,
  ZOOM_MAXIMO,
  ZOOM_MINIMO,
  alternarZoomNoDuploToque,
  aplicarZoomEArrasto,
  limitarEixo,
  limitarEscala,
  limiteDeArrasto,
} from '../src/visorImagem';

const LARGURA = 1_000;
const ALTURA = 2_000;

describe('matemática do visor de imagem (zoom/arrasto/duplo toque)', () => {
  it('escala fica sempre entre 1x e 8x', () => {
    expect(limitarEscala(0.2)).toBe(ZOOM_MINIMO);
    expect(limitarEscala(1)).toBe(ZOOM_MINIMO);
    expect(limitarEscala(4)).toBe(4);
    expect(limitarEscala(50)).toBe(ZOOM_MAXIMO);
  });

  it('em repouso não há o que arrastar', () => {
    expect(limiteDeArrasto(ZOOM_MINIMO, LARGURA)).toBe(0);
    expect(limitarEixo(500, ZOOM_MINIMO, LARGURA)).toBe(0);
  });

  it('arrasto é limitado proporcional à escala, nunca deixando fundo vazio', () => {
    expect(limiteDeArrasto(2, LARGURA)).toBe(500);
    expect(limitarEixo(10_000, 2, LARGURA)).toBe(500);
    expect(limitarEixo(-10_000, 2, LARGURA)).toBe(-500);
    expect(limitarEixo(200, 2, LARGURA)).toBe(200);
  });

  it('zoom no centro só aumenta a escala, sem deslocar', () => {
    const resultado = aplicarZoomEArrasto(TRANSFORMACAO_INICIAL, LARGURA / 2, ALTURA / 2, 0, 0, 2, LARGURA, ALTURA);
    expect(resultado.escala).toBe(2);
    expect(resultado.deslocamentoX).toBeCloseTo(0);
    expect(resultado.deslocamentoY).toBeCloseTo(0);
  });

  it('zoom fora do centro mantém o ponto sob o cursor/dedo', () => {
    // Ponto 250px à esquerda do centro; sem correção fugiria mais pra
    // esquerda (o conteúdo cresce a partir do centro do container).
    const toqueX = LARGURA / 2 - 250;
    const resultado = aplicarZoomEArrasto(TRANSFORMACAO_INICIAL, toqueX, ALTURA / 2, 0, 0, 2, LARGURA, ALTURA);
    expect(resultado.escala).toBe(2);
    expect(resultado.deslocamentoX).toBeCloseTo(250);
  });

  it('zoom nunca passa de 8x mesmo com fator de roda/pinça enorme', () => {
    const resultado = aplicarZoomEArrasto(TRANSFORMACAO_INICIAL, LARGURA / 2, ALTURA / 2, 0, 0, 100, LARGURA, ALTURA);
    expect(resultado.escala).toBe(ZOOM_MAXIMO);
  });

  it('arrasto puro em repouso não move a imagem', () => {
    const resultado = aplicarZoomEArrasto(TRANSFORMACAO_INICIAL, LARGURA / 2, ALTURA / 2, 300, 300, 1, LARGURA, ALTURA);
    expect(resultado.deslocamentoX).toBe(0);
    expect(resultado.deslocamentoY).toBe(0);
  });

  it('duplo toque de 1x vai para 2,5x focado no ponto tocado', () => {
    const toqueX = LARGURA / 2 + 100;
    const toqueY = ALTURA / 2 + 40;
    const resultado = alternarZoomNoDuploToque(TRANSFORMACAO_INICIAL, toqueX, toqueY, LARGURA, ALTURA);
    expect(resultado.escala).toBe(ZOOM_DUPLO_TOQUE);
    expect(resultado.deslocamentoX).toBeCloseTo(-150);
    expect(resultado.deslocamentoY).toBeCloseTo(-60);
  });

  it('duplo toque com zoom ativo sempre volta a 1x recentralizado', () => {
    const comZoom = { escala: 4, deslocamentoX: 300, deslocamentoY: -200 };
    const resultado = alternarZoomNoDuploToque(comZoom, 10, 10, LARGURA, ALTURA);
    expect(resultado).toEqual(TRANSFORMACAO_INICIAL);
  });

  it('duplo toque bem longe do centro respeita o limite de arrasto em 2,5x', () => {
    const resultado = alternarZoomNoDuploToque(TRANSFORMACAO_INICIAL, LARGURA * 3, ALTURA * 3, LARGURA, ALTURA);
    const limiteX = limiteDeArrasto(ZOOM_DUPLO_TOQUE, LARGURA);
    const limiteY = limiteDeArrasto(ZOOM_DUPLO_TOQUE, ALTURA);
    expect(resultado.deslocamentoX).toBe(-limiteX);
    expect(resultado.deslocamentoY).toBe(-limiteY);
  });
});
