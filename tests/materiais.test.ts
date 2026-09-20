// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { codificarBase64 } from '../src/bytes';
import { validarCaminho } from '../src/github';
import { CHAVE_LATERAL, criarLateral, type ArmazenamentoLateral } from '../src/lateral';
import {
  analisarManifesto,
  CAMINHO_MANIFESTO,
  CHAVE_LATERAL_MATERIAIS,
  construirArvoreMateriais,
  grandeParaLinkDireto,
  lerManifestoMateriais,
  LIMITE_DOWNLOAD_DIRETO,
  tamanhoLegivel,
  urlAbrir,
  urlBaixar,
  type Material,
} from '../src/materiais';
import { construirArvore } from '../src/tree';

const data = '2026-09-19T12:00:00Z';
const material = (caminho: string, size = 1_600_000): Material => ({
  id: `id-${caminho.length}`, name: caminho.split('/').at(-1)!, size, modifiedTime: data, caminho,
});
const manifesto = (arquivos: Material[]) => ({ versao: 1, geradoEm: data, arquivos });
const resposta = (dados: unknown, status = 200) => new Response(JSON.stringify(dados), { status });
const fetchFalso = (dados: unknown, status = 200): typeof fetch =>
  vi.fn(async () => resposta(dados, status)) as unknown as typeof fetch;

function storage(): ArmazenamentoLateral & { valores: Map<string, string> } {
  const valores = new Map<string, string>();
  return { valores, getItem: (chave) => valores.get(chave) ?? null, setItem: (chave, valor) => { valores.set(chave, valor); } };
}

describe('handoff 08 · manifesto e materiais', () => {
  it('145. 374 PDFs em lista plana montam Matéria → Aula sem usar construirArvore', () => {
    const arquivos = Array.from({ length: 374 }, (_, i) =>
      material(`Matéria ${i % 3}/Aula ${Math.floor(i / 3)}/${i}.pdf`));
    const estado = analisarManifesto(manifesto(arquivos), Date.parse(data));
    expect(estado.tipo).toBe('pronto');
    const arvore = construirArvoreMateriais(arquivos);
    expect(arvore.notas).toHaveLength(374);
    expect(arvore.pastas.has('Matéria 0/Aula 0')).toBe(true);
    expect(arvore.raiz.totalNotas).toBe(374);
    expect(manifesto(arquivos)).not.toHaveProperty('raiz');
  });

  it('146. ausência é estado normal e leitura usa caminho fixo com Fetcher injetado', async () => {
    const mock = fetchFalso({}, 404);
    const estado = await lerManifestoMateriais('segredo', mock);
    expect(estado.tipo).toBe('ausente');
    expect(estado).toHaveProperty('mensagem');
    expect(vi.mocked(mock).mock.calls[0][0]).toContain(`/contents/${CAMINHO_MANIFESTO}?ref=master`);
    expect(vi.mocked(mock).mock.calls[0][1]?.method).toBeUndefined();
  });

  it('147. JSON corrompido e versão desconhecida são recusados sem lançar', async () => {
    const corrompido = fetchFalso({ content: codificarBase64('{invalido', false) });
    expect((await lerManifestoMateriais('x', corrompido)).tipo).toBe('invalido');
    expect(analisarManifesto({ ...manifesto([]), versao: 2 }).tipo).toBe('invalido');
    expect(analisarManifesto(manifesto([material('../fora.pdf')])).tipo).toBe('invalido');
  });

  it('148–151. visualizador, download direto pequeno, página Drive grande e tamanho', () => {
    const pequeno = material('Genética/Aula/Pequeno.pdf');
    const grande = material('Microbiologia/P1/Microbiologia P1 - 08 - apostila final.pdf', 318_213_516);
    expect(urlAbrir(pequeno)).toBe(`https://drive.google.com/file/d/${pequeno.id}/view`);
    expect(urlBaixar(pequeno)).toBe(`https://drive.google.com/uc?export=download&id=${pequeno.id}`);
    expect(grandeParaLinkDireto(pequeno)).toBe(false);
    expect(grandeParaLinkDireto(grande)).toBe(true);
    expect(urlBaixar(grande)).toBe(urlAbrir(grande));
    expect(LIMITE_DOWNLOAD_DIRETO).toBe(100_000_000);
    expect(tamanhoLegivel(grande.size)).toContain('318,2 MB');
  });

  it('152. as duas laterais preservam expansão em chaves diferentes', () => {
    const memoria = storage();
    const notas = criarLateral(construirArvore(['06_Conhecimento/Genética/A.md']), memoria, vi.fn(), vi.fn());
    const materiais = criarLateral(
      construirArvoreMateriais([material('Microbiologia/P1/A.pdf')]), memoria, vi.fn(), vi.fn(), true,
      undefined, undefined, undefined, undefined, undefined,
      { chaveEstado: CHAVE_LATERAL_MATERIAIS, titulo: 'Materiais', unidade: 'PDFs' },
    );
    notas.elemento.querySelector<HTMLButtonElement>('[data-caminho="Genética"]')!.click();
    materiais.elemento.querySelector<HTMLButtonElement>('[data-caminho="Microbiologia"]')!.click();
    expect(JSON.parse(memoria.valores.get(CHAVE_LATERAL)!)).toMatchObject({ expandidas: ['Genética'] });
    expect(JSON.parse(memoria.valores.get(CHAVE_LATERAL_MATERIAIS)!)).toMatchObject({ expandidas: ['Microbiologia'] });
    expect(notas.elemento.querySelector('[data-caminho="Genética"]')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('36–40. leitor não expõe Google nem muda a validação de notas; índice velho segue navegável', async () => {
    const dados = manifesto([material('Genética/Aula/PDF.pdf')]);
    const mock = fetchFalso({ content: codificarBase64(JSON.stringify(dados), false) });
    const estado = await lerManifestoMateriais('x', mock);
    expect(estado.tipo).toBe('pronto');
    expect(vi.mocked(mock).mock.calls).toHaveLength(1);
    expect(String(vi.mocked(mock).mock.calls[0][0])).toMatch(/^https:\/\/api\.github\.com\//);
    expect(analisarManifesto(dados, Date.parse(data) + 8 * 24 * 60 * 60 * 1000)).toMatchObject({ tipo: 'pronto', antigo: true });
    expect(() => validarCaminho(CAMINHO_MANIFESTO)).toThrow();
    expect(() => validarCaminho('06_Conhecimento/PDF.pdf')).toThrow();
  });
});
