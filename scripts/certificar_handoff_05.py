"""Certificação do handoff 05 no Edge, usando a UI e respostas GitHub em memória."""
from __future__ import annotations

import base64
import json
import statistics
from pathlib import Path
from time import perf_counter


NOTA_REAL = Path(
    r"E:\Obsidian\CONHECIMENTO\06_Conhecimento\Medicina\Matérias Básicas"
    r"\Microbiologia\Aula Introdução à micro.md"
)
CAMINHO = "06_Conhecimento/Medicina/Matérias Básicas/Microbiologia/Aula Introdução à micro.md"


def certificar(navegador, url: str) -> bool:
    falhas: list[str] = []

    def verificar(caso: int, titulo: str, passou: bool, detalhe: str = "") -> None:
        print(f"{'OK' if passou else 'FALHA'} {caso}. {titulo}{'; ' + detalhe if detalhe else ''}")
        if not passou:
            falhas.append(str(caso))

    def abrir_nota(conteudo: bytes):
        contexto = navegador.new_context(viewport={"width": 1280, "height": 900})
        pagina = contexto.new_page()
        erros: list[str] = []
        gravacoes: list[bytes] = []
        pagina.on("pageerror", lambda erro: erros.append(str(erro)))

        def responder(rota) -> None:
            req = rota.request
            if "/git/trees/master" in req.url:
                dados = {"tree": [{"path": CAMINHO, "type": "blob"}]}
                rota.fulfill(status=200, content_type="application/json", body=json.dumps(dados))
            elif "/contents/" in req.url and req.method == "GET":
                dados = {"content": base64.b64encode(conteudo).decode("ascii"), "sha": "sha-e2e"}
                rota.fulfill(status=200, content_type="application/json", body=json.dumps(dados))
            elif "/contents/" in req.url and req.method == "PUT":
                corpo = req.post_data_json
                gravacoes.append(base64.b64decode(corpo["content"]))
                rota.fulfill(status=200, content_type="application/json", body='{"content":{"sha":"sha-novo"}}')
            else:
                rota.fulfill(status=404, content_type="application/json", body="{}")

        pagina.route("https://api.github.com/**", responder)
        pagina.goto(url, wait_until="networkidle", timeout=30_000)
        pagina.locator("#token").fill("github_pat_E2E_LOCAL")
        pagina.get_by_role("button", name="Entrar").click()
        pagina.get_by_role("searchbox", name="Filtrar notas por nome").fill("Aula Introdução à micro")
        pagina.locator(".item-nota").first.click()
        pagina.locator(".cm-editor").wait_for(state="visible")
        return contexto, pagina, erros, gravacoes

    def modo(pagina, nome: str) -> None:
        pagina.get_by_role("button", name=nome, exact=True).click()

    def texto_editor(pagina) -> str:
        return pagina.locator(".cm-content").inner_text()

    def medir_teclas(pagina, nome: str) -> tuple[float, float]:
        modo(pagina, nome)
        pagina.locator(".cm-line").nth(2).click()
        pagina.keyboard.press("End")
        amostras = []
        for _ in range(200):
            inicio = perf_counter()
            pagina.keyboard.press("x")
            pagina.evaluate("() => new Promise(requestAnimationFrame)")
            amostras.append((perf_counter() - inicio) * 1000)
        ordenadas = sorted(amostras)
        return statistics.median(amostras), ordenadas[189]

    original = NOTA_REAL.read_bytes()
    verificar(83, "nota real carregada", len(original) == 88_656, f"{len(original)} bytes")
    contexto, pagina, erros, gravacoes = abrir_nota(original)
    modo(pagina, "Ao vivo")
    pagina.get_by_role("button", name="Salvar", exact=True).click()
    pagina.wait_for_timeout(100)
    verificar(83, "salvar sem editar preserva bytes", gravacoes == [original] and not erros)
    mediana_ao_vivo, p95_ao_vivo = medir_teclas(pagina, "Ao vivo")
    contexto.close()

    contexto, pagina, erros, _ = abrir_nota(original)
    mediana_fonte, p95_fonte = medir_teclas(pagina, "Fonte")
    verificar(
        92, "200 teclas na nota real de 88 KB",
        not erros,
        f"Ao vivo mediana {mediana_ao_vivo:.1f} ms, p95 {p95_ao_vivo:.1f} ms; "
        f"Fonte mediana {mediana_fonte:.1f} ms, p95 {p95_fonte:.1f} ms",
    )
    contexto.close()

    amostra = (
        "# Título\n**forte** e *itálico* e `código`\n#\n> citação\n"
        "# *ênfase*\n- **forte**\n```\n**bloco**\n```\n`**inline**`\nfim"
    ).encode("utf-8")
    contexto, pagina, erros, _ = abrir_nota(amostra)
    modo(pagina, "Ao vivo")
    pagina.locator(".cm-line").last.click()
    verificar(84, "forte fora do cursor sem asteriscos e em negrito",
             pagina.locator(".cm-lp-forte").first.inner_text() == "forte"
             and int(pagina.locator(".cm-lp-forte").first.evaluate(
                 "el => getComputedStyle(el).fontWeight")) >= 700
             and "**forte**" not in pagina.locator(".cm-line").nth(1).inner_text())
    pagina.locator(".cm-line").nth(1).click()
    verificar(85, "marcas cruas na linha do cursor", "**forte**" in pagina.locator(".cm-line").nth(1).inner_text())
    pagina.locator(".cm-line").last.click()
    verificar(86, "cabeçalho sem cerquilha nem espaço", pagina.locator(".cm-lp-h1").first.inner_text() == "Título")
    verificar(87, "linha só com cerquilha visível", pagina.locator(".cm-line").nth(2).inner_text() == "#")
    pagina.locator(".cm-line").first.click()
    pagina.keyboard.press("Home")
    pagina.keyboard.down("Shift")
    for _ in range(4):
        pagina.keyboard.press("ArrowDown")
    pagina.keyboard.up("Shift")
    visivel = texto_editor(pagina)
    verificar(88, "seleção em três linhas revela as marcas", "# Título" in visivel
             and "**forte**" in visivel and "> citação" in visivel)
    pagina.locator(".cm-line").last.click()
    verificar(89, "marcas aninhadas sem exceção", not erros
             and pagina.locator(".cm-lp-bolinha").count() == 1
             and pagina.locator(".cm-lp-enfase").count() >= 1)
    verificar(90, "asteriscos dentro de código intactos", "**bloco**" in visivel
             and "**inline**" in visivel)
    modo(pagina, "Fonte")
    verificar(93, "números visíveis em Fonte", pagina.locator(".cm-lineNumbers").count() == 1)
    modo(pagina, "Ao vivo")
    verificar(93, "números ausentes em Ao vivo", pagina.locator(".cm-lineNumbers").count() == 0)
    identidade = pagina.evaluate("() => { window.__editorE2E = document.querySelector('.cm-editor'); return true }")
    modo(pagina, "Leitura")
    modo(pagina, "Ao vivo")
    verificar(91, "troca de modos preserva Salvo e editor", identidade
             and pagina.locator(".estado-salvo").inner_text() == "Salvo"
             and pagina.evaluate("() => window.__editorE2E === document.querySelector('.cm-editor')"))
    contexto.close()

    titulos = "\n".join(f"{'#' * n} Título {n}" for n in range(1, 7)) + "\nfim"
    contexto, pagina, erros, _ = abrir_nota(titulos.encode())
    modo(pagina, "Ao vivo")
    pagina.locator(".cm-line").last.click()
    largura_editor = pagina.locator(".cm-content").evaluate("el => el.getBoundingClientRect().width")
    estilos_editor = [pagina.locator(f".cm-lp-h{i}").first.evaluate(
        "el => ({font: getComputedStyle(el).fontSize, color: getComputedStyle(el).color})"
    ) for i in range(1, 7)]
    modo(pagina, "Leitura")
    largura_leitura = pagina.locator(".leitura-markdown").evaluate("el => el.getBoundingClientRect().width")
    estilos_leitura = [pagina.locator(f".leitura-markdown h{i}").first.evaluate(
        "el => ({font: getComputedStyle(el).fontSize, color: getComputedStyle(el).color})"
    ) for i in range(1, 7)]
    verificar(94, "largura da coluna Ao vivo = Leitura", abs(largura_editor - largura_leitura) < 1,
             f"{largura_editor:.1f} px / {largura_leitura:.1f} px")
    verificar(95, "h1–h6: tamanho e cor iguais à Leitura", estilos_editor == estilos_leitura,
             f"Ao vivo {estilos_editor}; Leitura {estilos_leitura}")
    contexto.close()

    longa = ("- " + "palavra " * 40 + "\n  - " + "palavra " * 40
             + "\n    - " + "palavra " * 40 + "\nfim")
    contexto, pagina, erros, _ = abrir_nota(longa.encode())
    modo(pagina, "Ao vivo")
    pagina.locator(".cm-line").last.click()
    listas = pagina.locator(".cm-line.cm-lp-lista").evaluate_all(
        "els => els.map(el => ({pad: parseFloat(getComputedStyle(el).paddingLeft), "
        "indent: parseFloat(getComputedStyle(el).textIndent), "
        "height: el.getBoundingClientRect().height, "
        "line: parseFloat(getComputedStyle(el).lineHeight)}))"
    )
    verificar(96, "três níveis com continuação e recuo crescente", len(listas) == 3
             and all(item["height"] > item["line"] * 1.5 and item["indent"] == -20 for item in listas)
             and listas[0]["pad"] < listas[1]["pad"] < listas[2]["pad"], str(listas))
    contexto.close()

    crlf = b"**forte**\r\nlinha\r\nfim"
    contexto, pagina, erros, gravacoes = abrir_nota(crlf)
    modo(pagina, "Ao vivo")
    pagina.locator(".cm-line").nth(1).click()
    pagina.keyboard.press("End")
    pagina.keyboard.press("X")
    pagina.get_by_role("button", name="Salvar", exact=True).click()
    pagina.wait_for_timeout(100)
    verificar(97, "CRLF editado preservado ao salvar", gravacoes == [b"**forte**\r\nlinhaX\r\nfim"])
    contexto.close()

    contexto, pagina, erros, gravacoes = abrir_nota(b"**forte**\rtexto\nfim")
    modo(pagina, "Ao vivo")
    pagina.locator(".cm-line").last.click()
    verificar(98, "CR isolado abre decorado e não permite salvar",
             pagina.locator(".cm-lp-forte").count() >= 1
             and pagina.get_by_role("button", name="Salvar", exact=True).is_disabled()
             and not gravacoes and not erros)
    contexto.close()

    # 99 e 100 são certificados pelo npm test e pelo reporter de coleta.
    print("INFO 99–100. execute npm test; a saída audita os casos 1–82, os 9 arquivos e Errors 0")
    return not falhas
