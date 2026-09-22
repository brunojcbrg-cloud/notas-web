"""Certifica os oito casos de sugestão de wikilink no Edge real.

GitHub fica inteiramente em memória. O blob remoto pode ser suspenso para provar
o estado de carregamento antes da resposta.
"""
from __future__ import annotations

import base64
import json
from urllib.parse import unquote, urlsplit


P = "06_Conhecimento/"
ATUAL = f"{P}Neuro/Atual.md"
MEDULA = f"{P}Neuro/Medula Espinal.md"
REPETIDA_A = f"{P}Neuro/Sem título.md"
REPETIDA_B = f"{P}Outra/Sem título.md"
NOTA = "\ufeff# Nota aberta\r\n## Seção local\r\nCorpo\r\n".encode()
NOTA_MEDULA = "# Anatomia\n## Substância cinzenta\n### Tratos ascendentes\n".encode()


def certificar(navegador, url: str) -> bool:
    falhas: list[int] = []

    def verificar(caso: int, titulo: str, passou: bool, detalhe: str = "") -> None:
        print(f"{'OK' if passou else 'FALHA'} {caso}. {titulo}{'; ' + detalhe if detalhe else ''}")
        if not passou:
            falhas.append(caso)

    def abrir(nota: bytes = NOTA, suspender_blob: bool = False, toque: bool = False):
        contexto = navegador.new_context(
            viewport={"width": 1280, "height": 900}, has_touch=toque
        )
        pagina = contexto.new_page()
        estado = {"blob_calls": 0, "pendentes": [], "puts": [], "erros": []}
        pagina.on("pageerror", lambda erro: estado["erros"].append(str(erro)))

        blobs = {
            ATUAL: "sha-atual",
            MEDULA: "sha-medula",
            REPETIDA_A: "sha-repetida-a",
            REPETIDA_B: "sha-repetida-b",
        }

        def responder(rota) -> None:
            req = rota.request
            caminho_url = unquote(urlsplit(req.url).path)
            if "/git/trees/master" in caminho_url:
                dados = {
                    "sha": "tree-wikilink",
                    "tree": [
                        {"path": caminho, "type": "blob", "sha": sha}
                        for caminho, sha in blobs.items()
                    ],
                }
            elif "/git/blobs/sha-medula" in caminho_url:
                estado["blob_calls"] += 1
                if suspender_blob and not estado["pendentes"]:
                    estado["pendentes"].append(rota)
                    return
                dados = {"content": base64.b64encode(NOTA_MEDULA).decode("ascii")}
            elif f"/contents/{ATUAL}" in caminho_url and req.method == "GET":
                dados = {
                    "content": base64.b64encode(nota).decode("ascii"),
                    "sha": "sha-atual",
                }
            elif f"/contents/{ATUAL}" in caminho_url and req.method == "PUT":
                corpo = req.post_data_json
                estado["puts"].append(base64.b64decode(corpo["content"]))
                dados = {
                    "content": {"sha": "sha-atual-salvo"},
                    "commit": {"tree": {"sha": "tree-salva"}},
                }
            else:
                rota.fulfill(status=404, content_type="application/json", body="{}")
                return
            rota.fulfill(status=200, content_type="application/json", body=json.dumps(dados))

        pagina.route("https://api.github.com/**", responder)
        pagina.goto(url, wait_until="networkidle", timeout=30_000)
        pagina.locator("#token").fill("github_pat_E2E_WIKILINK")
        pagina.get_by_role("button", name="Entrar", exact=True).click()
        pagina.get_by_role("searchbox", name="Filtrar notas por nome").fill("Atual")
        pagina.locator(".item-nota").first.click()
        pagina.locator(".cm-editor").wait_for(state="visible")
        return contexto, pagina, estado

    def acrescentar(pagina, texto: str) -> None:
        pagina.locator(".cm-content").click()
        pagina.keyboard.press("Control+End")
        pagina.keyboard.type(texto)

    contexto, pagina, estado = abrir()
    try:
        acrescentar(pagina, "[[medu")
        opcao = pagina.locator(".cm-completionLabel", has_text="Medula Espinal")
        opcao.wait_for(state="visible")
        pagina.keyboard.press("Enter")
        texto = pagina.locator(".cm-content").inner_text()
        verificar(
            160,
            "[[medu sugere e aceita [[Medula Espinal]]",
            texto.endswith("[[Medula Espinal]]") and not estado["erros"],
        )
        pagina.get_by_role("button", name="Salvar", exact=True).click()
        pagina.wait_for_function(
            "() => document.querySelector('.estado-salvo')?.textContent === 'Salvo'"
        )
        esperado = NOTA + b"[[Medula Espinal]]"
        verificar(
            161,
            "texto salvo por textoExato fica byte a byte igual ao esperado",
            estado["puts"] == [esperado],
            f"{len(estado['puts'][0]) if estado['puts'] else 0}/{len(esperado)} bytes",
        )
    finally:
        contexto.close()

    contexto, pagina, estado = abrir()
    try:
        acrescentar(pagina, "[[#")
        pagina.locator(".cm-completionLabel", has_text="Seção local").wait_for(
            state="visible"
        )
        titulos = pagina.locator(".cm-completionLabel").all_inner_texts()
        verificar(
            162,
            "[[# lista cabeçalhos da nota aberta sem rede",
            "Nota aberta" in titulos
            and "Seção local" in titulos
            and estado["blob_calls"] == 0
            and not estado["erros"],
        )
    finally:
        contexto.close()

    contexto, pagina, estado = abrir(suspender_blob=True)
    try:
        acrescentar(pagina, "[[Medula Espinal#subst")
        pagina.locator(".cm-completionLabel", has_text="Carregando seções").wait_for(
            state="visible"
        )
        carregando = len(estado["pendentes"]) == 1
        pendente = estado["pendentes"].pop()
        pendente.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps(
                {"content": base64.b64encode(NOTA_MEDULA).decode("ascii")}
            ),
        )
        pagina.locator(
            ".cm-completionLabel", has_text="Substância cinzenta"
        ).wait_for(state="visible")
        pagina.keyboard.press("Escape")
        pagina.keyboard.press("Enter")
        pagina.keyboard.type("[[Medula Espinal#subst")
        pagina.locator(
            ".cm-completionLabel", has_text="Substância cinzenta"
        ).wait_for(state="visible")
        verificar(
            163,
            "[[Nome# mostra carregamento, busca uma vez e reutiliza o SHA",
            carregando and estado["blob_calls"] == 1 and not estado["erros"],
            f"{estado['blob_calls']} chamada(s) ao blob",
        )
    finally:
        contexto.close()

    contexto, pagina, estado = abrir(toque=True)
    try:
        acrescentar(pagina, "[[sem título")
        repetidas = pagina.locator(
            ".cm-completionLabel", has_text="Sem título"
        )
        repetidas.first.wait_for(state="visible")
        detalhes = pagina.locator(".cm-completionDetail").all_inner_texts()[:2]
        repetidas.first.tap()
        verificar(
            164,
            "homônimos mostram duas pastas e aceitam por toque",
            repetidas.count() == 0
            and set(detalhes) == {"Neuro", "Outra"}
            and pagina.locator(".cm-content").inner_text().endswith("[[Sem título]]")
            and not estado["erros"],
            f"pastas: {detalhes}",
        )
    finally:
        contexto.close()

    contexto, pagina, estado = abrir()
    try:
        acrescentar(pagina, "![[")
        pagina.wait_for_timeout(200)
        verificar(
            165,
            "![[ não abre sugestão de nota",
            pagina.locator(".cm-tooltip-autocomplete").count() == 0
            and not estado["erros"],
        )
    finally:
        contexto.close()

    contexto, pagina, estado = abrir(b"` `")
    try:
        pagina.locator(".cm-content").click()
        pagina.keyboard.press("Control+End")
        pagina.keyboard.press("ArrowLeft")
        pagina.keyboard.type("[[medu")
        pagina.wait_for_timeout(200)
        verificar(
            166,
            "dentro de crase não abre sugestão",
            pagina.locator(".cm-tooltip-autocomplete").count() == 0
            and not estado["erros"],
        )
    finally:
        contexto.close()

    contexto, pagina, estado = abrir()
    try:
        acrescentar(pagina, "[[medu")
        pagina.locator(".cm-tooltip-autocomplete").wait_for(state="visible")
        pagina.keyboard.press("Escape")
        texto = pagina.locator(".cm-content").inner_text()
        verificar(
            167,
            "Esc fecha sem inserir nada",
            pagina.locator(".cm-tooltip-autocomplete").count() == 0
            and texto.endswith("[[medu")
            and not estado["erros"],
        )
    finally:
        contexto.close()

    return not falhas
