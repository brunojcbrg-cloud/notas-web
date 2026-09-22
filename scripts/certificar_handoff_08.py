"""Certificação de Materiais no Edge com GitHub e Drive inteiramente falsos."""
from __future__ import annotations

import base64
import json
from datetime import datetime, timezone


CAMINHO = "05_Sistema/notas-web/materiais.json"


def certificar(navegador, url: str) -> bool:
    falhas: list[int] = []

    def verificar(caso: int, titulo: str, passou: bool, detalhe: str = "") -> None:
        print(f"{'OK' if passou else 'FALHA'} {caso}. {titulo}{'; ' + detalhe if detalhe else ''}")
        if not passou:
            falhas.append(caso)

    arquivos = [
        {"id": f"pdf-{i}", "name": f"Apostila {i:03}.pdf", "size": 1_600_000,
         "modifiedTime": "2026-09-19T12:00:00Z", "caminho": f"Matéria/Aula 01/Apostila {i:03}.pdf"}
        for i in range(372)
    ]
    pequeno = {"id": "pdf-pequeno", "name": "Apostila pequena.pdf", "size": 1_600_000,
               "modifiedTime": "2026-09-19T12:00:00Z", "caminho": "Matéria/Aula 01/Apostila pequena.pdf"}
    grande = {"id": "pdf-grande", "name": "Microbiologia P1 - 08 - apostila final.pdf", "size": 318_213_516,
              "modifiedTime": "2026-09-19T12:00:00Z", "caminho": "Matéria/Aula 01/Microbiologia P1 - 08 - apostila final.pdf"}
    arquivos.extend([pequeno, grande])

    def abrir_contexto(tipo: str = "pronto"):
        contexto = navegador.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=True)
        pagina = contexto.new_page()
        erros: list[str] = []
        downloads: list[str] = []
        pagina.on("pageerror", lambda erro: erros.append(str(erro)))

        def github(rota) -> None:
            caminho = rota.request.url
            if "/git/trees/master" in caminho:
                dados = {"sha": "tree-falso", "tree": [{"path": "06_Conhecimento/Genética/Nota.md", "type": "blob", "sha": "sha-falso"}]}
                rota.fulfill(status=200, content_type="application/json", body=json.dumps(dados))
            elif f"/contents/{CAMINHO}" in caminho:
                if tipo == "ausente":
                    rota.fulfill(status=404, content_type="application/json", body="{}")
                    return
                manifesto = {"versao": 3 if tipo == "invalido" else 1,
                             "geradoEm": datetime.now(timezone.utc).isoformat(), "arquivos": arquivos}
                if tipo == "corrompido":
                    conteudo = b"{erro"
                else:
                    conteudo = json.dumps(manifesto, ensure_ascii=False).encode("utf-8")
                rota.fulfill(status=200, content_type="application/json",
                             body=json.dumps({"content": base64.b64encode(conteudo).decode("ascii")}))
            else:
                rota.fulfill(status=404, content_type="application/json", body="{}")

        def drive(rota) -> None:
            if "/uc?" in rota.request.url:
                downloads.append(rota.request.url)
                rota.fulfill(status=200, content_type="application/pdf",
                             headers={"Content-Disposition": 'attachment; filename="apostila.pdf"'}, body=b"%PDF-1.4\n%%EOF")
            else:
                rota.fulfill(status=200, content_type="text/html", body="<title>Visualizador falso do Drive</title>")

        pagina.route("https://api.github.com/**", github)
        contexto.route("https://drive.google.com/**", drive)
        pagina.goto(url, wait_until="networkidle")
        pagina.locator("#token").fill("github_pat_FALSO_MATERIAIS")
        pagina.get_by_role("button", name="Entrar").click()
        pagina.locator(".lista-corpo").wait_for(state="visible")
        pagina.locator(".lista-acoes button", has_text="Materiais").click()
        pagina.locator(".materiais-corpo").wait_for(state="visible")
        return contexto, pagina, erros, downloads

    contexto, pagina, erros, downloads = abrir_contexto()
    try:
        verificar(145, "374 PDFs em árvore por matéria e aula",
                 pagina.locator(".lateral-nota").count() == 374
                 and pagina.locator('.lateral-pasta[data-caminho="Matéria/Aula 01"]').count() == 1
                 and "374 materiais" in pagina.locator(".materiais-resumo").inner_text(),
                 f"{pagina.locator('.lateral-nota').count()} arquivos")
        pagina.locator(".item-pasta").first.click()
        pagina.locator(".item-pasta").first.click()
        pequeno_linha = pagina.locator('.item-material[data-caminho="Matéria/Aula 01/Apostila pequena.pdf"]')
        grande_linha = pagina.locator('.item-material[data-caminho="Matéria/Aula 01/Microbiologia P1 - 08 - apostila final.pdf"]')
        with contexto.expect_page() as popup_evento:
            pequeno_linha.locator(".material-abrir").click()
        popup = popup_evento.value
        popup.wait_for_load_state()
        verificar(148, "Abrir leva a nova aba do visualizador Drive",
                 popup.url == "https://drive.google.com/file/d/pdf-pequeno/view"
                 and "Visualizador falso" in popup.title())
        popup.close()
        pequeno_linha.locator(".material-baixar").click()
        pagina.wait_for_timeout(100)
        verificar(149, "Baixar PDF pequeno usa link direto e recebe PDF falso",
                 any("export=download&id=pdf-pequeno" in pedido for pedido in downloads))
        verificar(150, "PDF de 318 MB marcado e download leva à página do Drive",
                 grande_linha.locator(".material-grande").is_visible()
                 and grande_linha.locator(".material-baixar").get_attribute("href") == "https://drive.google.com/file/d/pdf-grande/view")
        verificar(151, "tamanho visível antes de clicar",
                 "1,6 MB" in pequeno_linha.locator(".material-tamanho").inner_text()
                 and "318,2 MB" in grande_linha.locator(".material-tamanho").inner_text())
        pagina.locator('.lateral-pasta[data-caminho="Matéria"]').click()
        pagina.locator('.lateral-pasta[data-caminho="Matéria/Aula 01"]').click()
        pagina.locator('.lateral-arvore').evaluate("el => { el.scrollTop = 120; }")
        rolagem_antes = pagina.locator('.lateral-arvore').evaluate("el => el.scrollTop")
        pagina.locator('.abas-secao button[data-secao="conhecimento"]').click()
        pagina.locator('.lateral-pasta[data-caminho="Genética"]').click()
        pagina.locator('.abas-secao button[data-secao="materiais"]').click()
        material_aberta = pagina.locator('.lateral-pasta[data-caminho="Matéria/Aula 01"]').get_attribute("aria-expanded") == "true"
        rolagem_depois = pagina.locator('.lateral-arvore').evaluate("el => el.scrollTop")
        pagina.locator('.abas-secao button[data-secao="conhecimento"]').click()
        nota_aberta = pagina.locator('.lateral-pasta[data-caminho="Genética"]').get_attribute("aria-expanded") == "true"
        verificar(152, "troca de áreas mantém expansão e rolagem independentes",
                 material_aberta and nota_aberta and rolagem_antes > 0
                 and abs(rolagem_depois - rolagem_antes) <= 1 and not erros,
                 f"rolagem materiais {rolagem_antes} → {rolagem_depois}")
    finally:
        contexto.close()

    contexto, pagina, erros, _ = abrir_contexto("ausente")
    try:
        verificar(146, "manifesto ausente informa sem quebrar notas",
                 "Manifesto ainda não gerado" in pagina.locator(".materiais-estado").inner_text()
                 and pagina.locator('.abas-secao button[data-secao="conhecimento"]').count() == 1
                 and not erros)
    finally:
        contexto.close()

    for tipo in ("invalido", "corrompido"):
        contexto, pagina, erros, _ = abrir_contexto(tipo)
        try:
            verificar(147, f"manifesto {tipo} recusado com mensagem",
                     "Manifesto de materiais inválido" in pagina.locator(".materiais-estado").inner_text() and not erros)
        finally:
            contexto.close()

    return not falhas
