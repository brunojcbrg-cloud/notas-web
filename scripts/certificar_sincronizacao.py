"""Certifica no Edge o painel "Sincronização" do §3.5 do handoff da tríade."""
from __future__ import annotations

import base64
import json
from urllib.parse import unquote, urlsplit


NOTA = "06_Conhecimento/Genética/Sincronizacao E2E.md"
REMOTO = "# Nota remota\n\nTexto já salvo."
TRECHO = "\n\nEdição ainda não enviada"


def certificar(navegador, url: str) -> bool:
    contexto = navegador.new_context(viewport={"width": 1280, "height": 900})
    pagina = contexto.new_page()
    erros: list[str] = []
    pagina.on("pageerror", lambda erro: erros.append(str(erro)))

    def github(rota) -> None:
        req = rota.request
        caminho = unquote(urlsplit(req.url).path)
        if "/git/trees/master" in caminho:
            dados = {"sha": "tree-sync", "tree": [
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
            # 503 propositalmente: o rascunho local tem de sobreviver a uma
            # gravação que ainda não chegou ao GitHub (mesmo caso do 237).
            rota.fulfill(status=503, content_type="application/json", body='{"message":"offline"}')
        else:
            rota.fulfill(status=404, content_type="application/json", body="{}")

    try:
        pagina.route("https://api.github.com/**", github)
        pagina.goto(url, wait_until="networkidle", timeout=30_000)
        pagina.locator("#token").fill("github_pat_E2E_SYNC")
        pagina.get_by_role("button", name="Entrar", exact=True).click()
        pagina.locator(".lista-corpo").wait_for(state="visible")

        pagina.get_by_role("searchbox", name="Filtrar notas por nome").fill("Sincronizacao E2E")
        pagina.locator(".item-nota").first.click()
        pagina.locator(".cm-editor").wait_for(state="visible")
        pagina.locator(".cm-content").click()
        pagina.keyboard.press("Control+End")
        pagina.keyboard.insert_text(TRECHO)

        rascunho_antes = pagina.evaluate("""() => Object.keys(localStorage)
          .some(k => k.startsWith('notas-web.rascunho.v1:'))""")

        # Sair da nota pela aba de seção dispara confirmarDescarte() (um
        # window.confirm nativo); recarregar em vez disso evita o dialogo e
        # prova que o rascunho sobrevive por conta própria no localStorage,
        # sem depender de a nota continuar aberta.
        pagina.evaluate("() => sessionStorage.clear()")
        pagina.once("dialog", lambda dialogo: dialogo.accept())
        pagina.reload(wait_until="networkidle")
        pagina.locator("#token").wait_for(state="visible")
        pagina.locator("#token").fill("github_pat_E2E_SYNC")
        pagina.get_by_role("button", name="Entrar", exact=True).click()
        pagina.locator(".lista-corpo").wait_for(state="visible")

        # O boot pos-login encontra o rascunho e oferece restaurar/descartar
        # (oferecerRascunho, main.ts:700) num <dialog> modal. Fechar com Esc
        # (evento "cancel" nativo, sem handler proprio) preserva o rascunho
        # sem reabrir a nota - e' so o que este caso precisa provar.
        dialogo_rascunho = pagina.locator('dialog[data-rascunho="true"]')
        if dialogo_rascunho.count() and dialogo_rascunho.is_visible():
            pagina.keyboard.press("Escape")
            dialogo_rascunho.wait_for(state="hidden", timeout=5_000)

        pagina.locator('.abas-secao button[data-secao="sincronizacao"]').click()
        painel = pagina.locator(".sync-web-corpo")
        painel.wait_for(state="visible", timeout=20_000)
        pagina.locator(".sync-web-cartao").nth(2).wait_for(state="attached", timeout=20_000)

        titulo = painel.locator("h1").inner_text()
        # Os <h2> dos cartões têm text-transform: uppercase no CSS; innerText
        # reflete o texto renderizado (maiúsculo), não o textContent original.
        cartoes = [c.lower() for c in painel.locator(".sync-web-cartao").all_inner_texts()]
        rascunhos_cartao = next((c for c in cartoes if "rascunhos locais" in c), "")
        ultima_cartao = next((c for c in cartoes if "última gravação" in c), "")
        comparacao_cartao = next((c for c in cartoes if "nota aberta" in c), "")
        nota_minuscula = NOTA.lower()

        passou = (
            rascunho_antes
            and "rascunho" in titulo.lower()
            and "1 preservado" in rascunhos_cartao
            and nota_minuscula in rascunhos_cartao
            and "falhou" in ultima_cartao
            and nota_minuscula in ultima_cartao
            and "nenhuma nota aberta" in comparacao_cartao
            and not erros
        )
        print(
            f"{'OK' if passou else 'FALHA'} 238. painel Sincronização mostra rascunho local pendente; "
            f"titulo={titulo!r}; erros JS={len(erros)}"
        )
        if not passou:
            print(
                "DETALHE 238:",
                repr({
                    "rascunho_antes": rascunho_antes,
                    "titulo": titulo,
                    "rascunhos_cartao": rascunhos_cartao,
                    "ultima_cartao": ultima_cartao,
                    "comparacao_cartao": comparacao_cartao,
                    "erros": erros,
                }),
            )
        return passou
    finally:
        contexto.close()
