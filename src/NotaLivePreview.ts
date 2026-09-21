/**
 * Porte reduzido do NotaLivePreview.ts do Life SO.
 *
 * Esta extensão só produz decorações do CodeMirror. Ela nunca despacha uma
 * alteração de documento: a fonte Markdown e seus terminadores permanecem
 * sob responsabilidade de NotaBytes.ts.
 */
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import {
  Compartment,
  RangeSetBuilder,
  type Extension,
  type Range,
} from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import {
  acharEmbeds,
  acharWikilinks,
  atributosDaImagem,
  rotuloDoEmbed,
} from './markdown';
import { ehImagem } from './anexos';

/**
 * O modo ao vivo tem de mostrar o mesmo que o modo leitura -- a diferença é que
 * nele dá para editar. Wikilink é a primeira peça dessa igualdade: sem isto os
 * colchetes ficavam à mostra e o clique não levava a lugar nenhum.
 */
export interface OpcoesLivePreview {
  /** Devolve o caminho da nota apontada, ou nulo quando ela não existe. */
  resolver?: (alvo: string) => string | null;
  /** Chamado no clique. Quem navega é a tela, não a extensão. */
  aoAbrir?: (alvo: string, secao: string) => void;
  /**
   * Devolve a imagem pronta para exibir (data URL), ou nulo quando o anexo não
   * resolve. Quem busca no repositório é a tela; a extensão só desenha.
   */
  imagem?: (alvo: string) => Promise<string | null>;
}

/** Imagem remota fica como texto, a mesma decisão do modo leitura (I.7). */
const REMOTA = /^(?:https?:|data:)/i;

const MARCAS_OCULTAVEIS = new Set(['HeaderMark', 'EmphasisMark', 'CodeMark', 'QuoteMark']);
const MARCAS_VISIVEIS = new Set(['LinkMark']);

const BOLINHAS = ['•', '◦', '▪'] as const;

type NoSintatico = {
  name: string;
  parent: NoSintatico | null;
};

function contextoDeLista(no: NoSintatico): { nivel: number; tipo: string | null } {
  let ancestral = no.parent;
  let nivel = 0;
  let tipo: string | null = null;
  while (ancestral) {
    if (ancestral.name === 'BulletList' || ancestral.name === 'OrderedList') {
      tipo ??= ancestral.name;
      nivel += 1;
    }
    ancestral = ancestral.parent;
  }
  return { nivel: Math.min(6, Math.max(1, nivel)), tipo };
}

class BolinhaLista extends WidgetType {
  constructor(readonly nivel: number) {
    super();
  }

  eq(outro: BolinhaLista): boolean {
    return outro.nivel === this.nivel;
  }

  toDOM(): HTMLElement {
    const elemento = document.createElement('span');
    elemento.className = `cm-lp-bolinha cm-lp-bolinha-n${this.nivel}`;
    elemento.textContent = BOLINHAS[(this.nivel - 1) % BOLINHAS.length];
    elemento.setAttribute('aria-hidden', 'true');
    return elemento;
  }
}

/**
 * A imagem do embed, no lugar do texto `![[…]]`.
 *
 * O `src` chega depois, assíncrono: quem tem o token e o cache é a tela. Como o
 * tamanho só é conhecido quando a imagem carrega, o editor é remedido no
 * `load`, senão a linha de baixo ficaria sobreposta até o próximo toque.
 */
class ImagemEmbutida extends WidgetType {
  constructor(
    readonly alvo: string,
    readonly rotulo: string,
    readonly carregar?: (alvo: string) => Promise<string | null>,
  ) {
    super();
  }

  eq(outro: ImagemEmbutida): boolean {
    return outro.alvo === this.alvo && outro.rotulo === this.rotulo;
  }

  toDOM(view: EditorView): HTMLElement {
    const { alt, largura } = atributosDaImagem(this.alvo, this.rotulo);
    const img = document.createElement('img');
    img.className = 'cm-lp-imagem';
    img.alt = alt;
    if (largura !== null) img.style.width = `${largura}px`;
    img.addEventListener('load', () => view.requestMeasure());
    const carregar = this.carregar;
    if (!carregar) {
      img.classList.add('cm-lp-imagem-faltante');
      return img;
    }
    void carregar(this.alvo).then(
      (fonte) => {
        if (fonte) img.src = fonte;
        else img.classList.add('cm-lp-imagem-faltante');
      },
      () => img.classList.add('cm-lp-imagem-faltante'),
    );
    return img;
  }

  /** Sem isto o clique na imagem não chega ao editor e o cursor não se move. */
  ignoreEvent(): boolean {
    return false;
  }
}

const CLASSES: Record<string, string> = {
  StrongEmphasis: 'cm-lp-forte',
  Emphasis: 'cm-lp-enfase',
  InlineCode: 'cm-lp-codigo',
};

/** Dentro de código o texto é literal: ali `[[x]]` não é wikilink. */
export function dentroDeCodigo(arvore: ReturnType<typeof syntaxTree>, posicao: number): boolean {
  let no: SyntaxNode | null = arvore.resolveInner(posicao, 1);
  while (no) {
    if (no.name.includes('Code')) return true;
    no = no.parent;
  }
  return false;
}

export function livePreview(opcoes: OpcoesLivePreview = {}): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;

      constructor(readonly view: EditorView) {
        this.decorations = this.construir(view);
      }

      update(atualizacao: ViewUpdate): void {
        if (
          atualizacao.docChanged ||
          atualizacao.selectionSet ||
          atualizacao.viewportChanged ||
          syntaxTree(atualizacao.startState) !== syntaxTree(atualizacao.state)
        ) {
          this.decorations = this.construir(atualizacao.view);
        }
      }

      construir(view: EditorView): DecorationSet {
        const { state } = view;
        const ranges: Range<Decoration>[] = [];
        const substituicoes: Range<Decoration>[] = [];
        const nivelDeLista = new Map<number, number>();
        const arvore = syntaxTree(state);

        for (const visivel of view.visibleRanges) {
          arvore.iterate({
            from: visivel.from,
            to: visivel.to,
            enter: (no) => {
              const linha = state.doc.lineAt(no.from);
              const linhaTocada = state.selection.ranges.some(
                (selecao) => selecao.from <= linha.to && selecao.to >= linha.from,
              );

              if (/^ATXHeading[1-6]$/.test(no.name)) {
                const nivel = Number(no.name.slice(-1));
                ranges.push(
                  Decoration.line({
                    attributes: { class: `cm-lp-titulo cm-lp-h${nivel}` },
                  }).range(linha.from),
                );
                return undefined;
              }

              if (no.name === 'Blockquote') {
                const fim = state.doc.lineAt(no.to).number;
                for (let i = linha.number; i <= fim; i += 1) {
                  const linhaDaCitacao = state.doc.line(i);
                  if (linhaDaCitacao.from < visivel.from || linhaDaCitacao.from > visivel.to) {
                    continue;
                  }
                  ranges.push(
                    Decoration.line({
                      attributes: { class: 'cm-lp-citacao' },
                    }).range(linhaDaCitacao.from),
                  );
                }
                return undefined;
              }

              if (no.name === 'ListItem') {
                const { nivel } = contextoDeLista(no.node);
                nivelDeLista.set(linha.from, Math.max(nivelDeLista.get(linha.from) ?? 0, nivel));
                return undefined;
              }

              if (no.name === 'ListMark') {
                const { nivel, tipo } = contextoDeLista(no.node);
                if (tipo === 'BulletList' && !linhaTocada) {
                  const substituicao = Decoration.replace({ widget: new BolinhaLista(nivel) })
                    .range(no.from, no.to);
                  ranges.push(substituicao);
                  substituicoes.push(substituicao);
                } else {
                  ranges.push(
                    Decoration.mark({ class: 'cm-lp-marcador' }).range(no.from, no.to),
                  );
                }
                return undefined;
              }

              // `![alt](arquivo.png)`: o modo leitura desenha, o ao vivo também.
              if (no.name === 'Image') {
                if (linhaTocada) return undefined;
                const endereco = no.node.getChild('URL');
                if (!endereco) return undefined;
                const origem = state.doc.sliceString(endereco.from, endereco.to).trim();
                if (REMOTA.test(origem) || !ehImagem(origem)) return undefined;
                const bruto = state.doc.sliceString(no.from, no.to);
                const rotulo = /^!\[([^\]]*)\]/.exec(bruto)?.[1] ?? '';
                const substituicao = Decoration.replace({
                  widget: new ImagemEmbutida(origem, rotulo, opcoes.imagem),
                }).range(no.from, no.to);
                ranges.push(substituicao);
                substituicoes.push(substituicao);
                return false;
              }

              if (no.name === 'HorizontalRule') {
                ranges.push(
                  Decoration.line({ attributes: { class: 'cm-lp-separador' } }).range(linha.from),
                );
                return undefined;
              }

              if (MARCAS_OCULTAVEIS.has(no.name)) {
                if (no.name === 'CodeMark' && no.node.parent?.name !== 'InlineCode') return undefined;
                let fim = no.to;
                if (no.name === 'HeaderMark' || no.name === 'QuoteMark') {
                  while (fim < linha.to && /\s/.test(state.doc.sliceString(fim, fim + 1))) fim += 1;
                }
                if (!linhaTocada && no.from >= linha.from && fim <= linha.to &&
                    !(no.from === linha.from && fim === linha.to)) {
                  const substituicao = Decoration.replace({}).range(no.from, fim);
                  ranges.push(substituicao);
                  substituicoes.push(substituicao);
                } else {
                  ranges.push(
                    Decoration.mark({ class: 'cm-lp-marcador' }).range(no.from, no.to),
                  );
                }
                return undefined;
              }

              if (MARCAS_VISIVEIS.has(no.name)) {
                ranges.push(
                  Decoration.mark({ class: 'cm-lp-marcador' }).range(no.from, no.to),
                );
                return undefined;
              }

              const classe = CLASSES[no.name];
              if (classe) ranges.push(Decoration.mark({ class: classe }).range(no.from, no.to));
              return undefined;
            },
          });

          const primeira = state.doc.lineAt(visivel.from).number;
          const ultima = state.doc.lineAt(visivel.to).number;
          for (let numero = primeira; numero <= ultima; numero += 1) {
            const linha = state.doc.line(numero);
            const linhaTocada = state.selection.ranges.some(
              (selecao) => selecao.from <= linha.to && selecao.to >= linha.from,
            );
            for (const achado of acharWikilinks(linha.text, linha.from)) {
              if (dentroDeCodigo(arvore, achado.de)) continue;
              // Wikilink de seção (`[[#Titulo]]`) aponta para a nota aberta:
              // ela existe por definição, e nunca pode sair marcada de vermelho.
              const existe = achado.alvo.alvo
                ? (opcoes.resolver?.(achado.alvo.alvo) ?? null) !== null
                : true;
              ranges.push(
                Decoration.mark({
                  class: existe ? 'cm-lp-wikilink' : 'cm-lp-wikilink cm-lp-wikilink-faltante',
                  attributes: {
                    'data-wikilink': achado.alvo.alvo,
                    'data-wikilink-secao': achado.alvo.secao,
                  },
                }).range(achado.deTexto, achado.ateTexto),
              );
              // Com o cursor na linha os colchetes voltam: é onde ele edita.
              if (linhaTocada) {
                ranges.push(
                  Decoration.mark({ class: 'cm-lp-marcador' }).range(achado.de, achado.deTexto),
                  Decoration.mark({ class: 'cm-lp-marcador' }).range(achado.ateTexto, achado.ate),
                );
              } else {
                const abre = Decoration.replace({}).range(achado.de, achado.deTexto);
                const fecha = Decoration.replace({}).range(achado.ateTexto, achado.ate);
                ranges.push(abre, fecha);
                substituicoes.push(abre, fecha);
              }
            }
            // Embed de imagem. A linha que o cursor toca mostra o texto cru,
            // como em todo o resto do ao vivo -- é lá que ele edita.
            if (linhaTocada) continue;
            for (const achado of acharEmbeds(linha.text, linha.from)) {
              if (dentroDeCodigo(arvore, achado.de)) continue;
              // Embed de nota (`![[Outra nota]]`) fica cru, igual ao modo leitura.
              if (!ehImagem(achado.alvo.alvo)) continue;
              const substituicao = Decoration.replace({
                widget: new ImagemEmbutida(
                  achado.alvo.alvo,
                  rotuloDoEmbed(achado.alvo),
                  opcoes.imagem,
                ),
              }).range(achado.de, achado.ate);
              ranges.push(substituicao);
              substituicoes.push(substituicao);
            }
          }
        }

        nivelDeLista.forEach((nivel, from) => {
          ranges.push(
            Decoration.line({
              attributes: {
                class: 'cm-lp-lista',
                style: `--nivel: ${nivel}`,
              },
            }).range(from),
          );
        });

        const construtor = new RangeSetBuilder<Decoration>();
        ranges
          .sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide)
          .forEach((range) => {
            if (range.from < range.to && substituicoes.some((outra) => {
              if (outra === range || range.from >= outra.to || range.to <= outra.from) return false;
              // Uma marca pode envolver a substituição: é assim que negrito,
              // itálico e código continuam estilizando o texto entre delimitadores.
              return substituicoes.includes(range) ||
                range.from > outra.from || range.to < outra.to;
            })) return;
            construtor.add(range.from, range.to, range.value);
          });
        return construtor.finish();
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );

  return [
    plugin,
    EditorView.domEventHandlers({
      mousedown(evento) {
        const abrir = opcoes.aoAbrir;
        if (!abrir) return false;
        const alvoDoEvento = evento.target;
        if (!(alvoDoEvento instanceof Element)) return false;
        const elo = alvoDoEvento.closest<HTMLElement>('[data-wikilink]');
        if (!elo) return false;
        // Sem isto o clique só moveria o cursor, que é o que acontecia antes.
        evento.preventDefault();
        abrir(elo.dataset.wikilink ?? '', elo.dataset.wikilinkSecao ?? '');
        return true;
      },
    }),
  ];
}

export function configurarLivePreview(
  view: EditorView,
  compartimento: Compartment,
  ativo: boolean,
  opcoes: OpcoesLivePreview = {},
): void {
  view.dispatch({
    effects: compartimento.reconfigure(ativo ? livePreview(opcoes) : []),
  });
}

export default livePreview;
