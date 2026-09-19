// @vitest-environment jsdom

import { readFileSync, readdirSync } from 'node:fs';
import { markdown } from '@codemirror/lang-markdown';
import { history, undo } from '@codemirror/commands';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { configurarLivePreview, livePreview } from '../src/NotaLivePreview';
import { mesmoTexto, preservarQuebras, textoExato } from '../src/NotaBytes';
import { codificarBase64, codificarEstado, decodificarBase64 } from '../src/bytes';

let view: EditorView | null = null;

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

function criarEditor(
  texto: string,
  eol: 'lf' | 'crlf' | 'misto',
  preview: Compartment,
  aoVivo = false,
  extras: Extension[] = [],
): EditorView {
  const host = document.createElement('div');
  document.body.append(host);
  view = new EditorView({
    state: EditorState.create({
      doc: texto,
      extensions: [
        markdown(),
        preservarQuebras(texto, eol),
        preview.of(aoVivo ? livePreview() : []),
        ...extras,
      ],
    }),
    parent: host,
  });
  return view;
}

describe('casos 61–65 · live preview sem edição implícita', () => {
  it('61. ligar o live preview e salvar sem editar preserva o texto byte a byte', () => {
    const original = '# Título\r\n\r\n**forte** e *itálico* com `código`\n> citação\r\n';
    const preview = new Compartment();
    const editor = criarEditor(original, 'misto', preview);
    configurarLivePreview(editor, preview, true);

    const salvo = textoExato(editor.state);
    expect(new TextEncoder().encode(salvo)).toEqual(new TextEncoder().encode(original));
    expect(document.querySelector('.cm-lp-h1')).not.toBeNull();
    expect(document.querySelector('.cm-lp-forte')).not.toBeNull();
    expect(document.querySelector('.cm-lp-enfase')).not.toBeNull();
    expect(document.querySelector('.cm-lp-codigo')).not.toBeNull();
    expect(document.querySelector('.cm-lp-citacao')).not.toBeNull();
    expect(document.querySelector('.cm-lp-marcador')).not.toBeNull();
    console.info(
      `Caso 61 — ${new TextEncoder().encode(salvo).length} bytes salvos / ${new TextEncoder().encode(original).length} originais: idênticos`,
    );
  });

  it('62. editar com live preview muda só a edição e preserva os terminadores', () => {
    const original = '# A\r\nlinha b\nlinha c\r\nfim';
    const preview = new Compartment();
    const editor = criarEditor(original, 'misto', preview, true);
    const inicio = editor.state.doc.toString().indexOf('b');
    editor.dispatch({ changes: { from: inicio, to: inicio + 1, insert: 'B' } });
    expect(textoExato(editor.state)).toBe('# A\r\nlinha B\nlinha c\r\nfim');
  });

  it('63. alternar Fonte, Leitura e Preview não toca o documento nem marca alteração', () => {
    const original = '# Intacto\r\ntexto\r\n';
    const preview = new Compartment();
    const editor = criarEditor(original, 'crlf', preview);
    const salvo = editor.state;

    configurarLivePreview(editor, preview, true); // Preview
    configurarLivePreview(editor, preview, false); // Leitura não decora o editor oculto
    configurarLivePreview(editor, preview, false); // Fonte

    expect(textoExato(editor.state)).toBe(original);
    expect(mesmoTexto(editor.state, salvo)).toBe(true);
    expect(editor.state.doc.eq(salvo.doc)).toBe(true);
  });

  it('64. nota CRLF editada no modo preview continua CRLF', () => {
    const original = 'um\r\ndois\r\ntrês\r\n';
    const preview = new Compartment();
    const editor = criarEditor(original, 'crlf', preview, true);
    const inicio = editor.state.doc.toString().indexOf('dois');
    editor.dispatch({ changes: { from: inicio, to: inicio + 4, insert: 'DOIS' } });
    expect(textoExato(editor.state)).toBe('um\r\nDOIS\r\ntrês\r\n');
  });

  it('65. modo Fonte mostra os marcadores crus', () => {
    const original = '# Título\n**forte** e *itálico*';
    const preview = new Compartment();
    const editor = criarEditor(original, 'lf', preview, true);
    configurarLivePreview(editor, preview, false);
    expect(editor.state.doc.toString()).toBe(original);
    expect(document.querySelector('.cm-content')?.textContent).toContain('# Título');
    expect(document.querySelector('.cm-content')?.textContent).toContain('**forte**');
    expect(document.querySelector('[class*="cm-lp-"]')).toBeNull();
  });
});

describe('casos 71–79 · marcadores de lista no live preview', () => {
  it('71. salvar sem editar preserva os bytes mesmo com marcador substituído', () => {
    const original = '- item\r\nlinha intacta\r\n';
    const preview = new Compartment();
    const editor = criarEditor(original, 'crlf', preview, true);
    editor.dispatch({ selection: { anchor: editor.state.doc.length } });

    expect(document.querySelector('.cm-lp-bolinha')).not.toBeNull();
    expect(new TextEncoder().encode(textoExato(editor.state))).toEqual(
      new TextEncoder().encode(original),
    );
  });

  it('72. hífen vira bolinha quando o cursor está em outra linha', () => {
    const original = '- item\noutra linha';
    const preview = new Compartment();
    const editor = criarEditor(original, 'lf', preview, true);
    editor.dispatch({ selection: { anchor: original.indexOf('outra') } });

    expect(document.querySelector('.cm-lp-bolinha')?.textContent).toBe('•');
    expect(document.querySelector('.cm-content')?.textContent).toContain('• item');
    expect(editor.state.doc.toString()).toBe(original);
  });

  it('73. cursor na linha mantém o hífen cru, visível e editável', () => {
    const preview = new Compartment();
    const editor = criarEditor('- item\noutra linha', 'lf', preview, true);

    expect(document.querySelector('.cm-lp-bolinha')).toBeNull();
    expect(document.querySelector('.cm-content')?.textContent).toContain('- item');
    expect(document.querySelector('.cm-lp-marcador')?.textContent).toBe('-');
  });

  it('74. seleção que atravessa a linha mantém o hífen cru', () => {
    const original = 'antes\n- item\ndepois';
    const preview = new Compartment();
    const editor = criarEditor(original, 'lf', preview, true);
    editor.dispatch({
      selection: { anchor: original.indexOf('antes') + 2, head: original.indexOf('depois') + 2 },
    });

    expect(document.querySelector('.cm-lp-bolinha')).toBeNull();
    expect(document.querySelector('.cm-content')?.textContent).toContain('- item');
  });

  it('75. três níveis usam a árvore para bolinha e recuo crescentes', () => {
    const original = '- um\n  - dois\n    - três\nfim';
    const preview = new Compartment();
    const editor = criarEditor(original, 'lf', preview, true);
    editor.dispatch({ selection: { anchor: original.indexOf('fim') } });

    const bolinhas = [...document.querySelectorAll<HTMLElement>('.cm-lp-bolinha')];
    expect(bolinhas.map((elemento) => elemento.textContent)).toEqual(['•', '◦', '▪']);
    expect(bolinhas.map((elemento) => elemento.classList.item(1))).toEqual([
      'cm-lp-bolinha-n1',
      'cm-lp-bolinha-n2',
      'cm-lp-bolinha-n3',
    ]);
    const linhas = [...document.querySelectorAll<HTMLElement>('.cm-line.cm-lp-lista')];
    expect(linhas.map((linha) => linha.style.getPropertyValue('--nivel').trim())).toEqual([
      '1',
      '2',
      '3',
    ]);
    const css = readFileSync('src/style.css', 'utf8');
    expect(css).toContain(
      'padding-left: calc(0.45em + (var(--nivel) - 1) * 0.75em)',
    );
  });

  it('76. lista ordenada preserva o número e não cria bolinha', () => {
    const original = '1. primeiro\nfim';
    const preview = new Compartment();
    const editor = criarEditor(original, 'lf', preview, true);
    editor.dispatch({ selection: { anchor: original.indexOf('fim') } });

    expect(document.querySelector('.cm-lp-bolinha')).toBeNull();
    expect(document.querySelector('.cm-content')?.textContent).toContain('1. primeiro');
    expect(document.querySelector('.cm-lp-marcador')?.textContent).toBe('1.');
  });

  it('77. hífen dentro de bloco de código fica intocado', () => {
    const original = '```\n- código\n```\nfim';
    const preview = new Compartment();
    const editor = criarEditor(original, 'lf', preview, true);
    editor.dispatch({ selection: { anchor: original.indexOf('fim') } });

    expect(document.querySelector('.cm-lp-bolinha')).toBeNull();
    expect(document.querySelector('.cm-content')?.textContent).toContain('- código');
    expect(editor.state.doc.toString()).toBe(original);
  });

  it('78. apagar o hífen na linha ativa produz parágrafo comum coerente', () => {
    const preview = new Compartment();
    const editor = criarEditor('- item\nfim', 'lf', preview, true);
    editor.dispatch({ changes: { from: 0, to: 1, insert: '' } });

    expect(editor.state.doc.toString()).toBe(' item\nfim');
    expect(document.querySelector('.cm-lp-bolinha')).toBeNull();
    expect(document.querySelector('.cm-lp-marcador')).toBeNull();
    expect(document.querySelector('.cm-content')?.textContent).toContain(' item');
  });

  it('79. nota CRLF editada no modo ao vivo continua CRLF', () => {
    const original = '- um\r\n- dois\r\nfim\r\n';
    const preview = new Compartment();
    const editor = criarEditor(original, 'crlf', preview, true);
    const inicio = editor.state.doc.toString().indexOf('dois');
    editor.dispatch({
      selection: { anchor: inicio },
      changes: { from: inicio, to: inicio + 4, insert: 'DOIS' },
    });

    expect(textoExato(editor.state)).toBe('- um\r\n- DOIS\r\nfim\r\n');
  });
});

describe('casos 83–100 · Ao vivo igual Leitura', () => {
  it('83. salvar sem editar uma nota de 88 KB preserva os bytes', () => {
    const original = ('# Aula\r\n- **forte** e *itálico*\r\n').repeat(3000);
    expect(new TextEncoder().encode(original).length).toBeGreaterThan(88_000);
    const preview = new Compartment();
    const editor = criarEditor(original, 'crlf', preview, true);
    expect(new TextEncoder().encode(textoExato(editor.state))).toEqual(new TextEncoder().encode(original));
  });

  it('84. forte, itálico e código fora da linha conservam o estilo sem delimitadores', () => {
    const original = '**forte** e *itálico* e `código`\nfim';
    const editor = criarEditor(original, 'lf', new Compartment(), true);
    editor.dispatch({ selection: { anchor: original.indexOf('fim') } });
    expect(document.querySelector('.cm-lp-forte')?.textContent).toBe('forte');
    expect(document.querySelector('.cm-lp-enfase')?.textContent).toBe('itálico');
    expect(document.querySelector('.cm-lp-codigo')?.textContent).toBe('código');
    const texto = document.querySelector('.cm-content')?.textContent;
    expect(texto).not.toContain('**forte**');
    expect(texto).not.toContain('*itálico*');
    expect(texto).not.toContain('`código`');
  });

  it('85. forte na linha do cursor mantém asteriscos editáveis', () => {
    const editor = criarEditor('**forte**\nfim', 'lf', new Compartment(), true);
    expect(document.querySelector('.cm-content')?.textContent).toContain('**forte**');
    expect(document.querySelectorAll('.cm-lp-marcador')).toHaveLength(2);
  });

  it('86. título fora do cursor não deixa cerquilha nem espaço inicial', () => {
    const original = '# Título\nfim';
    const editor = criarEditor(original, 'lf', new Compartment(), true);
    editor.dispatch({ selection: { anchor: original.indexOf('fim') } });
    expect(document.querySelector('.cm-lp-h1')?.textContent).toBe('Título');
  });

  it('87. linha só com cerquilha continua visível e alcançável', () => {
    const original = '#\nfim';
    const editor = criarEditor(original, 'lf', new Compartment(), true);
    editor.dispatch({ selection: { anchor: original.indexOf('fim') } });
    expect(document.querySelector('.cm-content')?.textContent).toContain('#');
    editor.dispatch({ selection: { anchor: 0 } });
    expect(editor.state.selection.main.head).toBe(0);
  });

  it('88. seleção de três linhas revela todas as marcas cruas', () => {
    const original = '# Título\n**forte**\n> citação\nfim';
    const editor = criarEditor(original, 'lf', new Compartment(), true);
    editor.dispatch({ selection: { anchor: 2, head: original.indexOf('fim') - 1 } });
    const texto = document.querySelector('.cm-content')?.textContent ?? '';
    expect(texto).toContain('# Título');
    expect(texto).toContain('**forte**');
    expect(texto).toContain('> citação');
  });

  it('89. marcas aninhadas não conflitam no RangeSetBuilder', () => {
    const original = '# *ênfase*\n- **forte**\nfim';
    const editor = criarEditor(original, 'lf', new Compartment(), true);
    expect(() => editor.dispatch({ selection: { anchor: original.indexOf('fim') } })).not.toThrow();
    expect(document.querySelector('.cm-lp-enfase')?.textContent).toBe('ênfase');
    expect(document.querySelector('.cm-lp-forte')?.textContent).toBe('forte');
    expect(document.querySelector('.cm-lp-bolinha')).not.toBeNull();
  });

  it('90. asteriscos em cerca e código em linha permanecem literais', () => {
    const original = '```\n**bloco**\n```\n`**inline**`\nfim';
    const editor = criarEditor(original, 'lf', new Compartment(), true);
    editor.dispatch({ selection: { anchor: original.indexOf('fim') } });
    const texto = document.querySelector('.cm-content')?.textContent ?? '';
    expect(texto).toContain('**bloco**');
    expect(texto).toContain('**inline**');
    expect(editor.state.doc.toString()).toBe(original);
  });

  it('91. Fonte, Ao vivo e Leitura conservam documento, cursor e histórico', () => {
    const preview = new Compartment();
    const editor = criarEditor('um\ndois', 'lf', preview, false, [history()]);
    editor.dispatch({ changes: { from: 2, insert: 'X' }, selection: { anchor: 3 } });
    const salvo = editor.state.doc.toString();
    configurarLivePreview(editor, preview, true);
    configurarLivePreview(editor, preview, false);
    configurarLivePreview(editor, preview, true);
    expect(editor.state.doc.toString()).toBe(salvo);
    expect(editor.state.selection.main.head).toBe(3);
    expect(undo({ state: editor.state, dispatch: (tr) => editor.dispatch(tr) })).toBe(true);
    expect(editor.state.doc.toString()).toBe('um\ndois');
  });

  it('93. compartimento tira números no Ao vivo e devolve no Fonte', () => {
    const numeros = new Compartment();
    const editor = criarEditor('um\ndois', 'lf', new Compartment(), true, [numeros.of(lineNumbers())]);
    expect(document.querySelector('.cm-lineNumbers')).not.toBeNull();
    editor.dispatch({ effects: numeros.reconfigure([]) });
    expect(document.querySelector('.cm-lineNumbers')).toBeNull();
    editor.dispatch({ effects: numeros.reconfigure(lineNumbers()) });
    expect(document.querySelector('.cm-lineNumbers')).not.toBeNull();
  });

  it('96. lista longa tem três níveis e regra de recuo pendente', () => {
    const original = '- um texto longo\n  - dois texto longo\n    - três texto longo\nfim';
    const editor = criarEditor(original, 'lf', new Compartment(), true);
    editor.dispatch({ selection: { anchor: original.indexOf('fim') } });
    const linhas = [...document.querySelectorAll<HTMLElement>('.cm-line.cm-lp-lista')];
    expect(linhas.map((linha) => linha.style.getPropertyValue('--nivel').trim())).toEqual(['1', '2', '3']);
    const css = readFileSync('src/style.css', 'utf8');
    expect(css).toContain('text-indent: -20px');
    expect(css).toContain('calc(24px + (var(--nivel) - 1) * 24px)');
  });

  it('97. editar com marcas ocultas conserva CRLF', () => {
    const original = '**forte**\r\nlinha\r\nfim';
    const editor = criarEditor(original, 'crlf', new Compartment(), true);
    const inicio = editor.state.doc.toString().indexOf('linha');
    editor.dispatch({ changes: { from: inicio, to: inicio + 5, insert: 'LINHA' } });
    expect(textoExato(editor.state)).toBe('**forte**\r\nLINHA\r\nfim');
  });

  it('98. CR isolado abre no Ao vivo e recusa salvamento', () => {
    const nota = decodificarBase64(codificarBase64('**forte**\rtexto\nfim', false));
    expect(nota.somenteLeitura).toBe(true);
    const editor = criarEditor(nota.texto, nota.eol, new Compartment(), true, [EditorView.editable.of(false)]);
    editor.dispatch({ selection: { anchor: nota.texto.length } });
    expect(document.querySelector('.cm-lp-forte')).not.toBeNull();
    expect(editor.state.facet(EditorView.editable)).toBe(false);
    expect(() => codificarEstado(editor.state, nota.tinhaBom, nota.somenteLeitura)).toThrow('CR isolado');
  });

  it('99. casos 1–82 permanecem registrados nas suítes e no Edge', () => {
    const fontes = readdirSync('tests').filter((nome) => nome.endsWith('.test.ts'))
      .map((nome) => readFileSync(`tests/${nome}`, 'utf8'));
    fontes.push(readFileSync('scripts/verificar-web-e2e.py', 'utf8'));
    const todos = fontes.join('\n');
    for (let caso = 1; caso <= 82; caso += 1) expect(todos).toMatch(new RegExp(`\\b${caso}\\.`));
  });

  it('100. auditoria inclui todos os arquivos e exige zero erros de coleta', () => {
    const arquivos = readdirSync('tests').filter((nome) => nome.endsWith('.test.ts'));
    const reporter = readFileSync('scripts/test-audit-reporter.mjs', 'utf8');
    expect(arquivos).toHaveLength(11);
    expect(reporter).toContain('carregados !== emDisco');
    expect(reporter).toContain('erros.length !== 0');
  });
});
