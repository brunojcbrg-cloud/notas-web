# Execute com: py -3.14 scripts/verificar-web-e2e.py
# O Python do PATH não contém o Playwright usado por esta certificação.
# -*- coding: utf-8 -*-
"""Casos 66 e 67: entrada no Edge real e token inválido sem erro JavaScript.

Por padrão certifica a página publicada. Para validar um servidor local antes
do push, passe ``--url http://127.0.0.1:4173/notas-web/``.
"""
from __future__ import annotations

import argparse


PUBLICADA = "https://brunojcbrg-cloud.github.io/notas-web/"
MENSAGEM_API = "Token inválido, expirado ou sem permissão Contents: Read and write."


def main() -> int:
    from playwright.sync_api import sync_playwright

    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=PUBLICADA)
    parser.add_argument("--ver", action="store_true", help="abre o Edge visível")
    args = parser.parse_args()

    erros_javascript: list[str] = []
    erros_console: list[str] = []
    erros_rede: list[str] = []

    with sync_playwright() as playwright:
        navegador = playwright.chromium.launch(channel="msedge", headless=not args.ver)
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
            pagina.goto(args.url, wait_until="networkidle", timeout=30_000)
            pagina.locator("#token").wait_for(state="visible", timeout=10_000)
            caso_66 = not erros_javascript and not erros_console
            print(
                f"{'OK' if caso_66 else 'FALHA'} 66. pagina carregada no Edge; "
                f"erros JavaScript: {len(erros_javascript) + len(erros_console)}"
            )

            pagina.locator("#token").fill("github_pat_TOKEN_INVALIDO_E2E")
            pagina.get_by_role("button", name="Entrar").click()
            status = pagina.locator(".mensagem.erro")
            status.wait_for(state="visible", timeout=20_000)
            texto = status.inner_text()
            caso_67 = (
                MENSAGEM_API in texto and not erros_javascript and not erros_console
            )
            print(
                f"{'OK' if caso_67 else 'FALHA'} 67. token invalido devolveu a mensagem da API; "
                f"erros JavaScript: {len(erros_javascript) + len(erros_console)}"
            )
            if erros_rede:
                print(f"INFO  respostas HTTP rejeitadas esperadas: {len(erros_rede)}")
            if erros_javascript or erros_console:
                print("ERROS:", *(erros_javascript + erros_console), sep="\n- ")
            if MENSAGEM_API not in texto:
                print(f"MENSAGEM RECEBIDA: {texto!r}")
            return 0 if caso_66 and caso_67 else 1
        finally:
            navegador.close()


if __name__ == "__main__":
    raise SystemExit(main())
