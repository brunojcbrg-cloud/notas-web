"""Certificação da Fase 2 do handoff de integração de três clientes (21/09):
manifesto versão 2, abrir HTML no iframe, voltar, PDF continuar abrindo no
Drive, e #materiais caindo na seção certa. GitHub e Drive inteiramente falsos.
"""
from __future__ import annotations

import base64
import json
from datetime import datetime, timezone


CAMINHO = "05_Sistema/notas-web/materiais.json"
APOSTILA_HTML = "<!doctype html><html><body><h1>Apostila falsa</h1><p>conteudo</p></body></html>"


def certificar(navegador, url: str) -> bool:
    falhas: list[int] = []

    def verificar(caso: str, titulo: str, passou: bool, detalhe: str = "") -> None:
        print(f"{'OK' if passou else 'FALHA'} {caso}. {titulo}{'; ' + detalhe if detalhe else ''}")
        if not passou:
            falhas.append(caso)

    arquivos = [
        {"id": "html-1", "name": "Aula 01 - 08 - apostila final.html", "size": 880_338,
         "modifiedTime": "2026-09-21T12:00:00Z", "caminho": "Genética/P1/Aula 01/Aula 01 - 08 - apostila final.html",
         "tipo": "html"},
        {"id": "pdf-1", "name": "Aula 01 - 08 - apostila final.pdf", "size": 1_888_746,
         "modifiedTime": "2026-09-21T12:00:00Z", "caminho": "Genética/P1/Aula 01/Aula 01 - 08 - apostila final.pdf",
         "tipo": "pdf"},
    ]

    def abrir_contexto(versao: int = 2, hash_inicial: str = ""):
        contexto = navegador.new_context(viewport={"width": 1280, "height": 900})
        pagina = contexto.new_page()
        erros: list[str] = []
        pedidos_drive: list[str] = []
        pagina.on("pageerror", lambda erro: erros.append(str(erro)))

        def github(rota) -> None:
            caminho = rota.request.url
            if "/git/trees/master" in caminho:
                dados = {"sha": "tree-falso", "tree": [{"path": "06_Conhecimento/Genética/Nota.md", "type": "blob", "sha": "sha-falso"}]}
                rota.fulfill(status=200, content_type="application/json", body=json.dumps(dados))
            elif f"/contents/{CAMINHO}" in caminho:
                manifesto = {"versao": versao, "geradoEm": datetime.now(timezone.utc).isoformat(), "arquivos": arquivos}
                conteudo = json.dumps(manifesto, ensure_ascii=False).encode("utf-8")
                rota.fulfill(status=200, content_type="application/json",
                             body=json.dumps({"content": base64.b64encode(conteudo).decode("ascii")}))
            else:
                rota.fulfill(status=404, content_type="application/json", body="{}")

        def drive(rota) -> None:
            pedidos_drive.append(rota.request.url)
            if "id=html-1" in rota.request.url:
                rota.fulfill(status=200, content_type="text/html", body=APOSTILA_HTML)
            elif "id=pdf-1" in rota.request.url:
                rota.fulfill(status=200, content_type="application/pdf", body=b"%PDF-1.4\n%%EOF")
            else:
                rota.fulfill(status=200, content_type="text/html", body="<title>Visualizador falso do Drive</title>")

        pagina.route("https://api.github.com/**", github)
        contexto.route("https://drive.google.com/**", drive)
        destino = url + hash_inicial
        pagina.goto(destino, wait_until="networkidle")
        pagina.locator("#token").fill("github_pat_FALSO_MATERIAIS_HTML")
        pagina.get_by_role("button", name="Entrar").click()
        return contexto, pagina, erros, pedidos_drive

    # #materiais leva direto a materiais depois do login.
    contexto, pagina, erros, _ = abrir_contexto(hash_inicial="#materiais")
    try:
        pagina.locator(".materiais-corpo").wait_for(state="visible", timeout=10_000)
        verificar(
            "2.3", "#materiais cai direto na seção de materiais depois do login",
            pagina.locator(".materiais-corpo").is_visible() and not erros,
        )
    finally:
        contexto.close()

    # Fluxo completo: manifesto v2, abrir HTML no iframe sandbox, voltar, PDF continua no Drive.
    contexto, pagina, erros, pedidos_drive = abrir_contexto()
    try:
        pagina.locator(".lista-acoes button", has_text="Materiais").click()
        pagina.locator(".materiais-corpo").wait_for(state="visible")
        # arquivos ficam em Genética/P1/Aula 01: desce as três pastas antes de medir.
        for _ in range(3):
            pagina.locator(".item-pasta").first.click()
        verificar(
            "manifesto-v2", "manifesto versão 2 com HTML+PDF carrega sem erro",
            pagina.locator(".item-material").count() == 2 and not erros,
        )

        linha_html = pagina.locator('.item-material[data-caminho="Genética/P1/Aula 01/Aula 01 - 08 - apostila final.html"]')
        verificar(
            "marca-html", "material HTML é rotulado como HTML, não PDF",
            linha_html.locator(".item-marca").inner_text() == "HTML",
        )

        linha_html.locator(".material-abrir-aqui").click()
        quadro = pagina.locator(".material-html-quadro")
        quadro.wait_for(state="visible", timeout=10_000)
        sandbox = quadro.get_attribute("sandbox")
        try:
            conteudo_frame = quadro.content_frame.locator("h1").inner_text(timeout=5_000)
        except Exception:
            conteudo_frame = ""
        verificar(
            "iframe-sandbox", "HTML abre em iframe sandbox sem allow-same-origin/allow-scripts",
            sandbox == "" and conteudo_frame == "Apostila falsa",
            f"sandbox={sandbox!r} conteudo={conteudo_frame!r}",
        )

        pagina.locator(".material-html-corpo button", has_text="Voltar").click()
        pagina.locator(".materiais-corpo").wait_for(state="visible")
        verificar("voltar", "Voltar retorna à lista de materiais", pagina.locator(".materiais-corpo").is_visible())

        linha_pdf = pagina.locator('.item-material[data-caminho="Genética/P1/Aula 01/Aula 01 - 08 - apostila final.pdf"]')
        verificar(
            "pdf-sem-abrir-aqui", "material PDF não ganha botão 'Abrir aqui'",
            linha_pdf.locator(".material-abrir-aqui").count() == 0,
        )
        with contexto.expect_page() as popup_evento:
            linha_pdf.locator(".material-abrir").click()
        popup = popup_evento.value
        popup.wait_for_load_state()
        verificar(
            "pdf-continua-drive", "PDF continua abrindo no Drive (não muda com a Fase 2)",
            popup.url == "https://drive.google.com/file/d/pdf-1/view",
        )
        popup.close()
    finally:
        contexto.close()

    # Regressão: manifesto versão 1 antigo (só PDF, sem campo tipo) ainda carrega.
    contexto, pagina, erros, _ = abrir_contexto(versao=1)
    try:
        pagina.locator(".lista-acoes button", has_text="Materiais").click()
        pagina.locator(".materiais-corpo").wait_for(state="visible")
        for _ in range(3):
            pagina.locator(".item-pasta").first.click()
        verificar(
            "regressao-v1", "manifesto versão 1 antigo ainda carrega sem erro",
            pagina.locator(".item-material").count() == 2 and not erros,
        )
    finally:
        contexto.close()

    return not falhas


def _main() -> int:
    # Execute com: py -3.14 scripts/certificar_materiais_html.py
    # O Python do PATH não contém o Playwright usado por esta certificação.
    import sys
    from functools import partial
    from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
    from pathlib import Path
    from threading import Thread

    from playwright.sync_api import sync_playwright

    sys.stdout.reconfigure(encoding="utf-8")

    docs = Path(__file__).resolve().parents[1] / "docs"
    if not (docs / "index.html").exists():
        raise SystemExit("Build ausente: execute npm run build antes da certificação.")

    class DocsHandler(SimpleHTTPRequestHandler):
        def do_GET(self) -> None:
            if not self.path.startswith("/notas-web/"):
                self.send_error(404)
                return
            self.path = self.path.removeprefix("/notas-web")
            super().do_GET()

        def log_message(self, _formato: str, *_args) -> None:
            pass

    servidor = ThreadingHTTPServer(("127.0.0.1", 0), partial(DocsHandler, directory=str(docs)))
    Thread(target=servidor.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{servidor.server_port}/notas-web/"
    try:
        with sync_playwright() as playwright:
            navegador = playwright.chromium.launch(channel="msedge", headless=True)
            try:
                return 0 if certificar(navegador, url) else 1
            finally:
                navegador.close()
    finally:
        servidor.shutdown()
        servidor.server_close()


if __name__ == "__main__":
    raise SystemExit(_main())
