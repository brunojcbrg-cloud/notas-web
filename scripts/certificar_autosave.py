"""Certifica no Edge a recuperação de rascunho após recarga e novo login."""
from __future__ import annotations

import base64
import json
from urllib.parse import unquote, urlsplit


NOTA = "06_Conhecimento/Genética/Rascunho E2E.md"
REMOTO = "# Nota remota\n\nTexto já salvo."
TRECHO = "\n\nEdição recuperável ãõ\nsegunda linha"


def certificar(navegador, url: str) -> bool:
    contexto = navegador.new_context(viewport={"width": 1280, "height": 900})
    pagina = contexto.new_page()
    erros: list[str] = []
    puts: list[str] = []
    pagina.on("pageerror", lambda erro: erros.append(str(erro)))

    def github(rota) -> None:
        req = rota.request
        caminho = unquote(urlsplit(req.url).path)
        if "/git/trees/master" in caminho:
            dados = {"sha": "tree-rascunho", "tree": [
                {"path": NOTA, "type": "blob", "sha": "sha-remoto"}
            ]}
            rota.fulfill(status=200, content_type="application/json", body=json.dumps(dados))
        elif caminho.endswith(f"/contents/{NOTA}") and req.method == "GET":
            dados = {
                "content": base64.b64encode(REMOTO.encode("utf-8")).decode("ascii"),
                "sha": "sha-remoto",
            }
            rota.fulfill(status=200, content_type="application/json", body=json.dumps(dados))
        elif caminho.endswith(f"/contents/{NOTA}") and req.method == "PUT":
            puts.append(req.post_data or "")
            rota.fulfill(status=503, content_type="application/json", body='{"message":"offline"}')
        else:
            rota.fulfill(status=404, content_type="application/json", body="{}")

    try:
        pagina.route("https://api.github.com/**", github)
        pagina.goto(url, wait_until="networkidle", timeout=30_000)
        pagina.locator("#token").fill("github_pat_E2E_RASCUNHO")
        pagina.get_by_role("button", name="Entrar", exact=True).click()
        pagina.get_by_role("searchbox", name="Filtrar notas por nome").fill("Rascunho E2E")
        pagina.locator(".item-nota").first.click()
        pagina.locator(".cm-editor").wait_for(state="visible")
        pagina.locator(".cm-content").click()
        pagina.keyboard.press("Control+End")
        pagina.keyboard.insert_text(TRECHO)

        texto_guardado = pagina.evaluate("""() => {
          const chave = Object.keys(localStorage).find(k => k.startsWith('notas-web.rascunho.v1:'));
          return chave ? JSON.parse(localStorage.getItem(chave)).texto : null;
        }""")
        pagina.evaluate("() => sessionStorage.clear()")
        pagina.once("dialog", lambda dialogo: dialogo.accept())
        pagina.reload(wait_until="networkidle")
        pagina.locator("#token").wait_for(state="visible")
        pagina.locator("#token").fill("github_pat_E2E_RASCUNHO")
        pagina.get_by_role("button", name="Entrar", exact=True).click()
        dialogo = pagina.locator('dialog[data-rascunho="true"]')
        dialogo.wait_for(state="visible", timeout=20_000)
        oferecido = "Rascunho E2E" in dialogo.inner_text()
        pagina.get_by_role("button", name="Restaurar edição", exact=True).click()
        pagina.locator(".cm-editor").wait_for(state="visible")
        restaurado = "\n".join(pagina.locator(".cm-line").all_text_contents())
        estado = pagina.locator(".estado-salvo").inner_text()
        persistiu = pagina.evaluate("""() => Object.keys(localStorage)
          .some(k => k.startsWith('notas-web.rascunho.v1:'))""")
        passou = (
            texto_guardado == REMOTO + TRECHO
            and restaurado == texto_guardado
            and oferecido
            and estado == "Alterações não gravadas"
            and persistiu
            and not erros
        )
        print(
            f"{'OK' if passou else 'FALHA'} 237. recarregar, entrar e restaurar devolve o texto exato; "
            f"rascunho={len(texto_guardado or '')} bytes; PUTs tentados={len(puts)}; erros JS={len(erros)}"
        )
        if not passou:
            print(
                "DETALHE 237:",
                repr({
                    "guardado": texto_guardado,
                    "esperado": REMOTO + TRECHO,
                    "restaurado": restaurado,
                    "oferecido": oferecido,
                    "estado": estado,
                    "persistiu": persistiu,
                    "erros": erros,
                }),
            )
        return passou
    finally:
        contexto.close()
