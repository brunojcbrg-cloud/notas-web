# Execute com: py -3.14 scripts/verificar-web-e2e.py
# -*- coding: utf-8 -*-
# O Python do PATH não contém o Playwright usado por esta certificação.
"""Casos 66–67, 83–98, 101–118, 145–167 e 237 no Edge real.

Por padrão serve o build docs/ local para certificar antes do push. Use --url
para conferir uma publicação específica depois do push.
"""
from __future__ import annotations

import argparse
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread



PUBLICADA = "https://brunojcbrg-cloud.github.io/notas-web/"
MENSAGEM_API = "Token inválido, expirado ou sem permissão Contents: Read and write."


class DocsHandler(SimpleHTTPRequestHandler):
    def do_GET(self) -> None:
        if not self.path.startswith("/notas-web/"):
            self.send_error(404)
            return
        self.path = self.path.removeprefix("/notas-web")
        super().do_GET()

    def log_message(self, _formato: str, *_args) -> None:
        pass


def main() -> int:
    from playwright.sync_api import sync_playwright

    sys.stdout.reconfigure(encoding="utf-8")
    sys.dont_write_bytecode = True
    from certificar_handoff_05 import certificar
    from certificar_handoff_06 import certificar as certificar_06
    from certificar_handoff_07 import certificar as certificar_07
    from certificar_handoff_08 import certificar as certificar_08
    from certificar_imagem_e_tema import certificar as certificar_imagem
    from certificar_sugestao_wikilink import certificar as certificar_wikilink
    from certificar_autosave import certificar as certificar_autosave

    parser = argparse.ArgumentParser()
    parser.add_argument("--url", help=f"endereço externo (padrão: docs/ local; publicado: {PUBLICADA})")
    parser.add_argument("--ver", action="store_true", help="abre o Edge visível")
    parser.add_argument("--screenshot", help="salva print com quatro níveis abertos")
    parser.add_argument("--autosave-only", action="store_true", help="executa somente o caso 237")
    args = parser.parse_args()

    erros_javascript: list[str] = []
    erros_console: list[str] = []
    erros_rede: list[str] = []

    servidor = None
    if args.url:
        url = args.url
    else:
        docs = Path(__file__).resolve().parents[1] / "docs"
        if not (docs / "index.html").exists():
            raise SystemExit("Build ausente: execute npm run build antes da certificação.")
        servidor = ThreadingHTTPServer(
            ("127.0.0.1", 0), partial(DocsHandler, directory=str(docs))
        )
        Thread(target=servidor.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{servidor.server_port}/notas-web/"

    try:
      with sync_playwright() as playwright:
        navegador = playwright.chromium.launch(channel="msedge", headless=not args.ver)
        if args.autosave_only:
            try:
                return 0 if certificar_autosave(navegador, url) else 1
            finally:
                navegador.close()
        pagina = navegador.new_context().new_page()
        pagina.on("pageerror", lambda erro: erros_javascript.append(str(erro)))

        def registrar_console(mensagem) -> None:
            if mensagem.type != "error":
                return
            if "Failed to load resource" in mensagem.text:
                erros_rede.append(mensagem.text)
            else:
                erros_console.append(mensagem.text)

        pagina.on("console", registrar_console)
        try:
            pagina.route(
                "https://api.github.com/**",
                lambda rota: rota.fulfill(
                    status=401,
                    content_type="application/json",
                    body='{"message":"Bad credentials"}',
                ),
            )
            pagina.goto(url, wait_until="networkidle", timeout=30_000)
            pagina.locator("#token").wait_for(state="visible", timeout=10_000)
            caso_66 = not erros_javascript and not erros_console
            print(
                f"{'OK' if caso_66 else 'FALHA'} 66. pagina carregada no Edge; "
                f"erros JavaScript: {len(erros_javascript) + len(erros_console)}"
            )

            pagina.locator("#token").fill("github_pat_TOKEN_INVALIDO_E2E")
            pagina.get_by_role("button", name="Entrar", exact=True).click()
            status = pagina.locator(".mensagem.erro")
            status.wait_for(state="visible", timeout=20_000)
            texto = status.inner_text()
            caso_67 = (
                MENSAGEM_API in texto and not erros_javascript and not erros_console
            )
            print(
                f"{'OK' if caso_67 else 'FALHA'} 67. resposta 401 simulada devolveu a mensagem da API; "
                f"erros JavaScript: {len(erros_javascript) + len(erros_console)}"
            )
            if erros_rede:
                print(f"INFO  respostas HTTP rejeitadas esperadas: {len(erros_rede)}")
            if erros_javascript or erros_console:
                print("ERROS:", *(erros_javascript + erros_console), sep="\n- ")
            if MENSAGEM_API not in texto:
                print(f"MENSAGEM RECEBIDA: {texto!r}")
            caso_05 = certificar(navegador, url) if caso_66 and caso_67 else False
            caso_06 = certificar_06(navegador, url, args.screenshot) if caso_05 else False
            caso_07 = certificar_07(navegador, url) if caso_06 else False
            caso_08 = certificar_08(navegador, url) if caso_07 else False
            caso_imagem = certificar_imagem(navegador, url) if caso_08 else False
            caso_wikilink = certificar_wikilink(navegador, url) if caso_imagem else False
            caso_autosave = certificar_autosave(navegador, url) if caso_wikilink else False
            return (
                0
                if caso_66 and caso_67 and caso_05 and caso_06 and caso_07 and caso_08 and caso_imagem and caso_wikilink and caso_autosave
                else 1
            )
        finally:
            navegador.close()
    finally:
        if servidor:
            servidor.shutdown()
            servidor.server_close()


if __name__ == "__main__":
    raise SystemExit(main())
