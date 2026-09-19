"""Certifica mover no Edge com uma Git Data API inteiramente em memória."""
from __future__ import annotations

import base64
import json
from urllib.parse import unquote, urlsplit


P = "06_Conhecimento/"
NOTA = f"{P}A/Nota.md"
DESTINO = f"{P}B/Nota.md"


def certificar(navegador, url: str) -> bool:
    falhas: list[int] = []

    def verificar(numero: int, descricao: str, passou: bool, detalhe: str = "") -> None:
        print(f"{'OK' if passou else 'FALHA'} {numero}. {descricao}{'; ' + detalhe if detalhe else ''}")
        if not passou:
            falhas.append(numero)

    def contexto_falso(largura=1280, conflito=False, relogio=False, links=False, homonimo=False):
        contexto = navegador.new_context(viewport={"width": largura, "height": 900})
        pagina = contexto.new_page()
        if relogio:
            pagina.clock.install()
        erros: list[str] = []
        pagina.on("pageerror", lambda erro: erros.append(str(erro)))
        estado = {
            "blobs": {NOTA: "blob-nota", f"{P}B/Outra.md": "blob-outra", **({f"{P}C/Nota.md": "blob-homonimo"} if homonimo else {}), **{
                f"{P}Genética/P3/Nota {i}.md": f"blob-p3-{i}" for i in range(77)
            }},
            "bytes": {"blob-nota": b"# Nota original\n", "blob-outra": (b"\xef\xbb\xbf# Outra\r\n" + b"[[Nota#Sec|alias]]\r\n" * 169 + b"fim") if links else b"# Outra\n", "blob-homonimo": b"# Homonimo\n", **{
                f"blob-p3-{i}": f"# Nota {i}\n".encode() for i in range(77)
            }},
            "tree_sha": "tree-inicial", "commit_sha": "commit-inicial",
            "pending": None, "calls": [], "puts": [], "blob_posts": [], "conflict": conflito,
        }

        def responder(rota) -> None:
            req = rota.request
            caminho_url = unquote(urlsplit(req.url).path)
            if "/git/trees/master" in caminho_url:
                dados = {"sha": estado["tree_sha"], "tree": [
                    {"path": caminho, "type": "blob", "sha": sha}
                    for caminho, sha in estado["blobs"].items()
                ]}
            elif "/contents/" in caminho_url:
                caminho = caminho_url.split("/contents/", 1)[1]
                if req.method == "GET":
                    sha = estado["blobs"].get(caminho)
                    if sha is None:
                        rota.fulfill(status=404, content_type="application/json", body="{}")
                        return
                    dados = {"sha": sha, "content": base64.b64encode(estado["bytes"][sha]).decode()}
                else:
                    corpo = req.post_data_json
                    estado["puts"].append((caminho, corpo))
                    novo_sha = f"blob-salvo-{len(estado['puts'])}"
                    estado["blobs"][caminho] = novo_sha
                    estado["bytes"][novo_sha] = base64.b64decode(corpo["content"])
                    estado["tree_sha"] = f"tree-salva-{len(estado['puts'])}"
                    dados = {"content": {"sha": novo_sha}, "commit": {"tree": {"sha": estado["tree_sha"]}}}
            elif "/git/blobs/" in caminho_url and req.method == "GET":
                sha = caminho_url.rsplit("/", 1)[-1]
                estado["calls"].append((req.method, caminho_url, None))
                dados = {"content": base64.b64encode(estado["bytes"][sha]).decode(), "encoding": "base64"}
            elif caminho_url.endswith("/git/blobs") and req.method == "POST":
                corpo = req.post_data_json
                estado["calls"].append((req.method, caminho_url, corpo))
                novo_sha = f"blob-reescrito-{len(estado['blob_posts']) + 1}"
                estado["bytes"][novo_sha] = base64.b64decode(corpo["content"])
                estado["blob_posts"].append(novo_sha)
                dados = {"sha": novo_sha}
            elif "/git/ref/heads/master" in caminho_url and req.method == "GET":
                estado["calls"].append((req.method, caminho_url, None))
                dados = {"object": {"sha": estado["commit_sha"]}}
            elif "/git/commits/" in caminho_url and req.method == "GET":
                estado["calls"].append((req.method, caminho_url, None))
                dados = {"tree": {"sha": estado["tree_sha"]}}
            elif caminho_url.endswith("/git/trees") and req.method == "POST":
                corpo = req.post_data_json
                estado["calls"].append((req.method, caminho_url, corpo))
                pendente = dict(estado["blobs"])
                for entrada in corpo["tree"]:
                    if entrada["sha"] is None:
                        pendente.pop(entrada["path"], None)
                    else:
                        pendente[entrada["path"]] = entrada["sha"]
                estado["pending"] = pendente
                dados = {"sha": "tree-movida"}
            elif caminho_url.endswith("/git/commits") and req.method == "POST":
                estado["calls"].append((req.method, caminho_url, req.post_data_json))
                dados = {"sha": "commit-movido"}
            elif "/git/refs/heads/master" in caminho_url and req.method == "PATCH":
                estado["calls"].append((req.method, caminho_url, req.post_data_json))
                if estado["conflict"]:
                    rota.fulfill(status=422, content_type="application/json", body='{"message":"branch moved"}')
                    return
                estado["blobs"] = estado["pending"]
                estado["tree_sha"] = "tree-movida"
                estado["commit_sha"] = "commit-movido"
                dados = {}
            else:
                rota.fulfill(status=404, content_type="application/json", body="{}")
                return
            rota.fulfill(status=200, content_type="application/json", body=json.dumps(dados))

        pagina.route("https://api.github.com/**", responder)
        pagina.goto(url, wait_until="networkidle")
        pagina.locator("#token").fill("token-inteiramente-falso")
        pagina.get_by_role("button", name="Entrar").click()
        pagina.locator(".lateral-pasta").first.wait_for(state="attached")
        return contexto, pagina, estado, erros

    contexto, pagina, estado, erros = contexto_falso()
    try:
        pagina.locator('.lateral-pasta[data-caminho="A"]').click()
        pagina.locator(f'.lateral-nota[data-caminho="{NOTA}"]').click()
        pagina.locator(".cm-editor").wait_for(state="visible")
        pagina.locator(".cm-content").click()
        pagina.keyboard.press("End")
        pagina.keyboard.type(" edição não salva")
        pagina.locator(f'.lateral-nota[data-caminho="{NOTA}"]').click(button="right")
        pagina.get_by_role("menuitem", name="Mover para…").click()
        pagina.locator("#destino-movimento").select_option("B")
        pagina.once("dialog", lambda dialogo: dialogo.dismiss())
        pagina.get_by_role("button", name="Mover", exact=True).click()
        verificar(123, "recusar salvar cancela mover e preserva a edição",
                 not estado["calls"] and NOTA in estado["blobs"]
                 and "edição não salva" in pagina.locator(".cm-content").inner_text())

        pagina.locator('.lateral-pasta[data-caminho="Genética"]').click()
        pagina.locator('.lateral-pasta[data-caminho="Genética/P3"]').click()
        pagina.locator(f'.lateral-nota[data-caminho="{NOTA}"]').click(button="right")
        pagina.get_by_role("menuitem", name="Mover para…").click()
        pagina.locator("#destino-movimento").select_option("B")
        pagina.locator('.lateral-arvore').evaluate("el => { el.scrollTop = 100; }")
        rolagem_antes = pagina.locator('.lateral-arvore').evaluate("el => el.scrollTop")
        pagina.evaluate("() => { window.__lateralAntes07 = document.querySelector('.lateral'); }")
        pagina.once("dialog", lambda dialogo: dialogo.accept())
        pagina.get_by_role("button", name="Mover", exact=True).click()
        pagina.locator(f'.lateral-nota[data-caminho="{DESTINO}"]').wait_for(state="attached")
        chamadas = list(estado["calls"])
        verificar(121, "nota movida com um commit e blob intacto",
                 len(chamadas) == 5 and len([c for c in chamadas if c[0] == "POST" and c[1].endswith("/commits")]) == 1
                 and estado["blobs"].get(DESTINO) == "blob-salvo-1"
                 and estado["bytes"][estado["blobs"][DESTINO]].startswith(b"# Nota original")
                 and NOTA not in estado["blobs"], f"{len(chamadas)} chamadas Git Data")
        pagina.locator(".cm-content").click()
        pagina.keyboard.press("End")
        pagina.keyboard.type(" mais texto")
        pagina.get_by_role("button", name="Salvar", exact=True).click()
        pagina.wait_for_function("() => document.querySelector('.estado-salvo')?.textContent === 'Salvo'")
        verificar(122, "nota aberta salva no caminho novo, sem recriar origem",
                 estado["puts"][-1][0] == DESTINO and NOTA not in estado["blobs"]
                 and b"mais texto" in estado["bytes"][estado["blobs"][DESTINO]],
                 f"PUT: {estado['puts'][-1][0]}")
        rolagem_depois = pagina.locator('.lateral-arvore').evaluate("el => el.scrollTop")
        mesma_lateral = pagina.evaluate("() => window.__lateralAntes07 === document.querySelector('.lateral')")
        selecionada = pagina.locator(f'.lateral-nota[data-caminho="{DESTINO}"]').get_attribute("aria-current")
        verificar(137, "árvore atualizada em memória, sem reler GitHub, e sem erro JS",
                 len(chamadas) == len(estado["calls"]) and not erros and mesma_lateral
                 and abs(rolagem_depois - rolagem_antes) <= 1 and selecionada == "page",
                 f"Git Data {len(chamadas)}→{len(estado['calls'])}, DOM {mesma_lateral}, rolagem {rolagem_antes}→{rolagem_depois}, selecionada {selecionada}, erros {erros}")
    finally:
        contexto.close()

    contexto, pagina, estado, erros = contexto_falso()
    try:
        pagina.locator('.lateral-pasta[data-caminho="Genética"]').click()
        pagina.locator('.lateral-pasta[data-caminho="Genética/P3"]').drag_to(
            pagina.locator('.lateral-pasta[data-caminho="B"]'))
        pagina.locator('.lateral-pasta[data-caminho="B/P3"]').wait_for(state="attached")
        chamadas = estado["calls"]
        verificar(125, "P3 com 77 notas: cinco chamadas, um commit, blobs intactos",
                 len(chamadas) == 5 and len(chamadas[2][2]["tree"]) == 154
                 and all(estado["blobs"].get(f"{P}B/P3/Nota {i}.md") == f"blob-p3-{i}" for i in range(77))
                 and not erros, f"{len(chamadas)} chamadas Git Data")
    finally:
        contexto.close()

    contexto, pagina, estado, erros = contexto_falso(conflito=True)
    try:
        pagina.locator('.lateral-pasta[data-caminho="A"]').click()
        avisos: list[str] = []
        pagina.once("dialog", lambda dialogo: (avisos.append(dialogo.message), dialogo.dismiss()))
        pagina.locator(f'.lateral-nota[data-caminho="{NOTA}"]').drag_to(
            pagina.locator('.lateral-pasta[data-caminho="B"]'))
        pagina.wait_for_timeout(300)
        verificar(127, "avanço do ramo: PATCH recusado, sem force e sem mutação",
                 len(estado["calls"]) == 5 and "force" not in estado["calls"][-1][2]
                 and NOTA in estado["blobs"] and DESTINO not in estado["blobs"]
                 and avisos and "mudou" in avisos[0] and not erros)
    finally:
        contexto.close()

    contexto, pagina, estado, erros = contexto_falso(largura=390)
    try:
        pagina.get_by_role("button", name="Abrir coluna lateral").click()
        pagina.locator('.lateral-pasta[data-caminho="A"]').click()
        pagina.locator(f'.lateral-nota[data-caminho="{NOTA}"] .lateral-mais').click()
        verificar(138, "telefone mostra Mover para… pelo botão de ações",
                 pagina.get_by_role("menuitem", name="Mover para…").is_visible() and not erros)
        pagina.locator('.lateral-topo').click()
        pagina.locator(f'.lateral-nota[data-caminho="{NOTA}"]').dispatch_event("touchstart")
        pagina.wait_for_timeout(600)
        pagina.locator(f'.lateral-nota[data-caminho="{NOTA}"]').dispatch_event("touchend")
        verificar(138, "toque longo abre o mesmo menu no telefone",
                 pagina.get_by_role("menuitem", name="Mover para…").is_visible() and not erros)
    finally:
        contexto.close()

    contexto, pagina, estado, erros = contexto_falso(relogio=True)
    try:
        pagina.locator('.lateral-pasta[data-caminho="A"]').click()
        pagina.clock.fast_forward(14 * 60 * 1000 + 59 * 1000)
        origem = pagina.locator(f'.lateral-nota[data-caminho="{NOTA}"]').bounding_box()
        destino = pagina.locator('.lateral-pasta[data-caminho="B"]').bounding_box()
        pagina.mouse.move(origem["x"] + 10, origem["y"] + 10)
        pagina.mouse.down()
        pagina.mouse.move(destino["x"] + 10, destino["y"] + 10, steps=8)
        pagina.clock.fast_forward(2000)
        ativa_apos_arrasto = not pagina.locator("#token").is_visible()
        pagina.clock.fast_forward(15 * 60 * 1000 + 1000)
        bloqueou_depois = pagina.locator("#token").is_visible()
        pagina.mouse.up()
        verificar(141, "iniciar arrasto renova o relógio de inatividade no Edge",
                 ativa_apos_arrasto and bloqueou_depois and not erros,
                 "ativa após 14min59s + arrasto + 2s; bloqueia 15min após o dragstart")
    finally:
        contexto.close()

    contexto, pagina, estado, erros = contexto_falso(links=True)
    try:
        avisos: list[str] = []
        def dialogo_renomear(dialogo) -> None:
            avisos.append(dialogo.message)
            if dialogo.type == "prompt":
                dialogo.accept("Renomeada")
            else:
                dialogo.accept()
        pagina.on("dialog", dialogo_renomear)
        pagina.locator('.lateral-pasta[data-caminho="A"]').click()
        pagina.locator(f'.lateral-nota[data-caminho="{NOTA}"]').click(button="right")
        pagina.get_by_role("menuitem", name="Renomear").click()
        novo = f"{P}A/Renomeada.md"
        pagina.locator(f'.lateral-nota[data-caminho="{novo}"]').wait_for(state="attached")
        bytes_links = estado["bytes"][estado["blobs"][f"{P}B/Outra.md"]]
        verificar(128, "renomear reescreve 169 wikilinks em um commit, com bytes intactos fora do nome",
                 estado["blobs"].get(novo) == "blob-nota" and NOTA not in estado["blobs"]
                 and len(estado["blob_posts"]) == 1
                 and bytes_links == (b"\xef\xbb\xbf# Outra\r\n" + b"[[Renomeada#Sec|alias]]\r\n" * 169 + b"fim")
                 and len([c for c in estado["calls"] if c[0] == "POST" and c[1].endswith("/git/commits")]) == 1
                 and any("169 wikilink(s) serão reescritos" in aviso for aviso in avisos)
                 and any("169 wikilink(s) reescritos" in aviso for aviso in avisos) and not erros,
                 f"{len(estado['calls'])} chamadas, {len(estado['blob_posts'])} blob novo")
    finally:
        contexto.close()

    contexto, pagina, estado, erros = contexto_falso(links=True, homonimo=True)
    try:
        avisos = []
        def dialogo_ambiguo(dialogo) -> None:
            avisos.append(dialogo.message)
            if dialogo.type == "prompt": dialogo.accept("Renomeada")
            else: dialogo.accept()
        pagina.on("dialog", dialogo_ambiguo)
        pagina.locator('.lateral-pasta[data-caminho="A"]').click()
        pagina.locator(f'.lateral-nota[data-caminho="{NOTA}"]').click(button="right")
        pagina.get_by_role("menuitem", name="Renomear").click()
        pagina.locator(f'.lateral-nota[data-caminho="{P}A/Renomeada.md"]').wait_for(state="attached")
        verificar(129, "links ambíguos não reescritos e 169 avisados na confirmação",
                 len(estado["blob_posts"]) == 0
                 and b"[[Nota#Sec|alias]]" in estado["bytes"][estado["blobs"][f"{P}B/Outra.md"]]
                 and any("169 ficarão de fora" in aviso for aviso in avisos)
                 and any("169 ficaram de fora" in aviso for aviso in avisos) and not erros)
    finally:
        contexto.close()

    contexto, pagina, estado, erros = contexto_falso()
    try:
        pagina.get_by_role("button", name="Nova nota", exact=True).click()
        pagina.locator("#nome-nota").fill("Anatomia/Ossos do crânio")
        pagina.get_by_role("button", name="Criar nota").click()
        novo = f"{P}Anatomia/Ossos do crânio.md"
        pagina.locator(f'.lateral-nota[data-caminho="{novo}"]').wait_for(state="attached")
        verificar(132, "Nova nota aceita subpasta no nome e revela pasta antes invisível",
                 estado["puts"][-1][0] == novo
                 and pagina.locator('.lateral-pasta[data-caminho="Anatomia"]').count() == 1
                 and estado["blobs"].get(novo) is not None and not erros)
    finally:
        contexto.close()

    contexto, pagina, estado, erros = contexto_falso()
    try:
        avisos = []
        def dialogo_pendente(dialogo) -> None:
            avisos.append(dialogo.message)
            if dialogo.type == "prompt": dialogo.accept("Leituras")
            else: dialogo.accept()
        pagina.on("dialog", dialogo_pendente)
        pagina.get_by_role("button", name="Nova pasta", exact=True).click()
        pendente = pagina.locator('.lateral-pasta[data-caminho="Leituras"]')
        pendente.wait_for(state="attached")
        rotulo = pendente.inner_text()
        pagina.reload(wait_until="networkidle")
        pagina.locator('.lateral-pasta[data-caminho="A"]').wait_for(state="attached")
        verificar(133, "pasta pendente avisa que some ao recarregar e não grava no Git",
                 "pendente" in rotulo.lower() and any("desaparecerá" in aviso for aviso in avisos)
                 and pagina.locator('.lateral-pasta[data-caminho="Leituras"]').count() == 0
                 and not estado["puts"] and not estado["calls"] and not erros)
    finally:
        contexto.close()

    return not falhas
