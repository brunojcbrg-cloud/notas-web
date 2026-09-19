/**
 * Porte reduzido do NotaLivePreview.ts do Life SO.
 *
 * Esta extensão só produz decorações do CodeMirror. Ela nunca despacha uma
 * alteração de documento: a fonte Markdown e seus terminadores permanecem
 * sob responsabilidade de NotaBytes.ts.
 */
import { syntaxTree } from '@codemirror/language';
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

const CLASSES: Record<string, string> = {
  StrongEmphasis: 'cm-lp-forte',
  Emphasis: 'cm-lp-enfase',
  InlineCode: 'cm-lp-codigo',
};

export function livePreview(): Extension {
  return ViewPlugin.fromClass(
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
}

export function configurarLivePreview(
  view: EditorView,
  compartimento: Compartment,
  ativo: boolean,
): void {
  view.dispatch({
    effects: compartimento.reconfigure(ativo ? livePreview() : []),
  });
}

export default livePreview;
