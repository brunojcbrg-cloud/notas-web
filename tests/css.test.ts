import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const claro = /:root\s*\{([^}]*)\}/s.exec(css)?.[1] ?? '';
const escuro = /:root\[data-modo-cor="dark"\]\s*\{([^}]*)\}/s.exec(css)?.[1] ?? '';

function valor(bloco: string, nome: string): string {
  const encontrado = new RegExp(`${nome}:\\s*([^;]+)`).exec(bloco)?.[1].trim();
  if (!encontrado) throw new Error(`Variável ausente: ${nome}`);
  return encontrado;
}

function luminancia(hex: string): number {
  const canais = hex
    .slice(1)
    .match(/../g)
    ?.map((canal) => Number.parseInt(canal, 16) / 255)
    .map((canal) =>
      canal <= 0.04045 ? canal / 12.92 : ((canal + 0.055) / 1.055) ** 2.4,
    );
  if (!canais || canais.length !== 3) throw new Error(`Cor inválida: ${hex}`);
  return 0.2126 * canais[0] + 0.7152 * canais[1] + 0.0722 * canais[2];
}

function contraste(frente: string, fundo: string): number {
  const a = luminancia(frente);
  const b = luminancia(fundo);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('casos 58–60 · contraste e tokens de cor', () => {
  it('58. texto corrido passa AA nos modos claro e escuro dos três temas', () => {
    const modos = {
      light: contraste(valor(claro, '--grafite'), valor(claro, '--papel')),
      dark: contraste(valor(escuro, '--grafite'), valor(escuro, '--papel')),
    };
    const resultados = ['padrao', 'obsidian', 'solarized'].flatMap((tema) =>
      Object.entries(modos).map(([modo, razao]) => ({ tema, modo, razao })),
    );
    for (const resultado of resultados) expect(resultado.razao).toBeGreaterThanOrEqual(4.5);
    console.info(
      `Caso 58 — ${resultados
        .map(({ tema, modo, razao }) => `${tema}/${modo}: ${razao.toFixed(2)}:1`)
        .join(' · ')}`,
    );
  });

  it('59. color do :root vem de variável redefinida no bloco escuro', () => {
    expect(claro).toMatch(/color:\s*var\(--grafite\)/);
    expect(valor(claro, '--grafite')).toBe('#242923');
    expect(valor(escuro, '--grafite')).toBe('#e5e8eb');
  });

  it('60. não há cor literal fora dos dois blocos de tema', () => {
    const foraDosTemas = css
      .replace(/:root\s*\{[^}]*\}/s, '')
      .replace(/:root\[data-modo-cor="dark"\]\s*\{[^}]*\}/s, '');
    expect(foraDosTemas).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    expect(foraDosTemas).not.toMatch(/:\s*(?:transparent|white|black)\s*(?:;|})/i);
  });
});
