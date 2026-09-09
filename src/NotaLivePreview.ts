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
} from '@codemirror/view';

const MARCAS_DISCRETAS = new Set([
  'HeaderMark',
  'EmphasisMark',
  'CodeMark',
  'QuoteMark',
  'LinkMark',
  'ListMark',
]);

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
          atualizacao.viewportChanged ||
          syntaxTree(atualizacao.startState) !== syntaxTree(atualizacao.state)
        ) {
          this.decorations = this.construir(atualizacao.view);
        }
      }

      construir(view: EditorView): DecorationSet {
        const { state } = view;
        const ranges: Range<Decoration>[] = [];
        const nivelDeLista = new Map<number, number>();

        for (const visivel of view.visibleRanges) {
          syntaxTree(state).iterate({
            from: visivel.from,
            to: visivel.to,
            enter: (no) => {
              const linha = state.doc.lineAt(no.from);

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
                const coluna = no.from - linha.from;
                const nivel = Math.min(6, Math.floor(coluna / 2) + 1);
                nivelDeLista.set(linha.from, Math.max(nivelDeLista.get(linha.from) ?? 0, nivel));
                return undefined;
              }

              if (MARCAS_DISCRETAS.has(no.name)) {
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
          .forEach((range) => construtor.add(range.from, range.to, range.value));
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
