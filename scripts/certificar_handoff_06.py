"""Certificação da coluna lateral no Edge com árvore sintética e API em memória."""
from __future__ import annotations

import base64
import json
from pathlib import Path
from urllib.parse import unquote, urlsplit


PREFIXO = "06_Conhecimento/"


def certificar(navegador, url: str, screenshot: str | None = None) -> bool:
    falhas: list[str] = []
    caminhos = sorted([
        *(f"{PREFIXO}Medicina/Matérias Básicas/Genética/P3/Nota {i:02}.md" for i in range(77)),
        *(f"{PREFIXO}Medicina/Anatomia/Aula {i:02}.md" for i in range(60)),
        f"{PREFIXO}Hipótese de ''Dois eventos/Nota.md",
        f"{PREFIXO}Hipótese de Dois eventos/Nota.md",
        f"{PREFIXO}Medicina/Anatomia/Um nome de nota bastante longo para verificar o corte com reticências.md",
    ])
    pastas_esperadas = {
        "/".join(partes[:indice])
        for caminho in caminhos
        for partes in [caminho.removeprefix(PREFIXO).split("/")]
        for indice in range(1, len(partes))
    }
    p3 = [c for c in caminhos if "/Genética/P3/" in c]
    nota_a, nota_b = p3[:2]
    nome_b = Path(nota_b).stem
    conteudos = {
        nota_a: f"# Primeira nota\n[[{nome_b}]]\nlinha original\n".encode(),
        nota_b: b"# Segunda nota\nlinha original\n",
    }

    def verificar(caso: int, descricao: str, passou: bool, detalhe: str = "") -> None:
        print(f"{'OK' if passou else 'FALHA'} {caso}. {descricao}{'; ' + detalhe if detalhe else ''}")
        if not passou:
            falhas.append(str(caso))

    def abrir_contexto(largura: int):
        contexto = navegador.new_context(viewport={"width": largura, "height": 900})
        pagina = contexto.new_page()
        erros: list[str] = []
        pagina.on("pageerror", lambda erro: erros.append(str(erro)))

        def responder(rota) -> None:
            req = rota.request
            if "/git/trees/master" in req.url:
                dados = {"sha": "tree-e2e", "tree": [{"path": caminho, "type": "blob", "sha": "sha-e2e"} for caminho in caminhos]}
                rota.fulfill(status=200, content_type="application/json", body=json.dumps(dados))
            elif "/contents/" in req.url and req.method == "GET":
                caminho = unquote(urlsplit(req.url).path.split("/contents/", 1)[1])
                texto = conteudos.get(caminho, f"# {Path(caminho).stem}\n".encode())
                dados = {"content": base64.b64encode(texto).decode(), "sha": "sha-e2e"}
                rota.fulfill(status=200, content_type="application/json", body=json.dumps(dados))
            else:
                rota.fulfill(status=404, content_type="application/json", body="{}")

        pagina.route("https://api.github.com/**", responder)
        pagina.goto(url, wait_until="networkidle")
        pagina.locator("#token").fill("github_pat_E2E_LATERAL")
        pagina.get_by_role("button", name="Entrar").click()
        pagina.locator(".lateral-nota").first.wait_for(state="attached")
        return contexto, pagina, erros

    def botao_nota(pagina, caminho: str):
        return pagina.locator(f'.lateral-nota[data-caminho="{caminho}"]')

    contexto, pagina, erros = abrir_contexto(1280)
    try:
        pastas = pagina.locator(".lateral-pasta").evaluate_all(
            "elementos => elementos.map(el => el.dataset.caminho)"
        )
        notas = pagina.locator(".lateral-nota").evaluate_all(
            "elementos => elementos.map(el => el.dataset.caminho)"
        )
        shell_unica = pagina.evaluate("() => document.querySelector('#app').children.length === 1 && document.querySelector('.cabecalho').getBoundingClientRect().top === 0")
        verificar(101, "árvore sintética sem duplicatas e casca única",
                 sorted(pastas) == sorted(pastas_esperadas) and sorted(notas) == caminhos
                 and shell_unica and not erros,
                 f"{len(pastas)} pastas com notas, {len(notas)} notas")
        verificar(102, "pastas irmãs com nomes quase iguais distintas",
                 pagina.locator('.lateral-pasta[data-caminho="Hipótese de Dois eventos"]').count() == 1
                 and pagina.locator('.lateral-pasta[data-caminho="Hipótese de \'\'Dois eventos"]').count() == 1)

        pagina.evaluate("""() => {
          for (const botao of document.querySelectorAll('.lateral-pasta')) {
            if (botao.getAttribute('aria-expanded') === 'false') botao.click();
          }
        }""")
        linhas = pagina.locator(".lateral-item").count()
        rolagem = pagina.locator(".lateral-arvore").evaluate(
            "el => ({total: el.scrollHeight, visivel: el.clientHeight})"
        )
        verificar(113, "todas as pastas abertas sem virtualização", linhas == len(caminhos) + len(pastas_esperadas) and rolagem["total"] > rolagem["visivel"],
                 f"{linhas} linhas, rolagem {rolagem['total']} px")

        pagina.evaluate("""() => {
          for (const botao of document.querySelectorAll('.lateral-pasta')) {
            if (botao.getAttribute('aria-expanded') === 'true') botao.click();
          }
        }""")
        for caminho in ["Medicina", "Medicina/Matérias Básicas", "Medicina/Matérias Básicas/Genética", "Medicina/Matérias Básicas/Genética/P3"]:
            pagina.locator(f'.lateral-pasta[data-caminho="{caminho}"]').click()
        botao_nota(pagina, nota_a).scroll_into_view_if_needed()
        botao_nota(pagina, nota_a).click()
        pagina.locator(".cm-editor").wait_for(state="visible")
        ancestrais = ["Medicina", "Medicina/Matérias Básicas", "Medicina/Matérias Básicas/Genética", "Medicina/Matérias Básicas/Genética/P3"]
        abertos = all(pagina.locator(f'.lateral-pasta[data-caminho="{c}"]').get_attribute("aria-expanded") == "true" for c in ancestrais)
        verificar(107, "nota ativa e quatro níveis ancestrais abertos", abertos and
                 botao_nota(pagina, nota_a).get_attribute("aria-current") == "page")

        if screenshot:
            destino = Path(screenshot)
            destino.parent.mkdir(parents=True, exist_ok=True)
            pagina.locator(".lateral-arvore").evaluate("el => { el.scrollTop = 0; }")
            pagina.screenshot(path=str(destino), full_page=False)
            print(f"INFO  print quatro níveis: {destino}")

        medidas = pagina.evaluate("""() => ({
          largura: document.querySelector('.lateral').getBoundingClientRect().width,
          recuos: [0,1,2,3,4].map(n => {
            const el = document.querySelector(`.lateral-item[data-nivel="${n}"]`);
            return el ? parseFloat(getComputedStyle(el).paddingLeft) : null;
          })
        })""")
        verificar(114, "largura e recuo por nível", medidas["largura"] == 280 and medidas["recuos"] == [7, 21, 35, 49, 63], str(medidas))

        pagina.locator(".lateral-arvore").evaluate("el => { el.scrollTop = 100; }")
        botao_nota(pagina, nota_b).scroll_into_view_if_needed()
        antes = pagina.locator(".lateral-arvore").evaluate("el => el.scrollTop")
        pagina.evaluate("() => { window.__lateralAntes = document.querySelector('.lateral'); }")
        botao_nota(pagina, nota_b).click()
        pagina.locator(".cm-editor").wait_for(state="visible")
        depois = pagina.locator(".lateral-arvore").evaluate("el => el.scrollTop")
        mesma_lateral = pagina.evaluate("() => window.__lateralAntes === document.querySelector('.lateral')")
        verificar(106, "trocar notas preserva DOM, rolagem e pastas", mesma_lateral and antes > 0 and abs(depois - antes) <= 1 and abertos,
                 f"rolagem {antes:.0f} → {depois:.0f} px")

        pagina.locator(".cm-content").click()
        pagina.keyboard.press("End")
        pagina.keyboard.type(" edição local")
        pagina.once("dialog", lambda dialogo: dialogo.dismiss())
        botao_nota(pagina, nota_a).click()
        verificar(104, "recusar descarte conserva nota e edição",
                 botao_nota(pagina, nota_b).get_attribute("aria-current") == "page"
                 and "edição local" in pagina.locator(".cm-content").inner_text()
                 and pagina.locator(".estado-salvo").inner_text() == "Alterações não gravadas")
        pagina.once("dialog", lambda dialogo: dialogo.accept())
        botao_nota(pagina, nota_a).click()
        pagina.locator(".cm-editor").wait_for(state="visible")
        verificar(105, "aceitar descarte abre a outra nota",
                 botao_nota(pagina, nota_a).get_attribute("aria-current") == "page"
                 and "Primeira nota" in pagina.locator(".cm-content").inner_text())

        texto_antes = pagina.locator(".cm-content").inner_text()
        pagina.evaluate("() => { window.__editorAntes = document.querySelector('.cm-editor'); }")
        pagina.get_by_role("button", name="Fechar coluna lateral").first.click()
        pagina.get_by_role("button", name="Abrir coluna lateral").click()
        verificar(111, "abrir e fechar preserva estado Salvo e editor",
                 pagina.locator(".estado-salvo").inner_text() == "Salvo"
                 and pagina.evaluate("() => window.__editorAntes === document.querySelector('.cm-editor')"))
        verificar(112, "texto antes e depois de alternar lateral idêntico", pagina.locator(".cm-content").inner_text() == texto_antes)

        pagina.get_by_role("button", name="Fechar coluna lateral").first.click()
        pagina.reload(wait_until="networkidle")
        pagina.locator(".lista-corpo").wait_for(state="visible")
        verificar(109, "recarregar mantém lateral fechada", pagina.locator(".lateral").is_hidden())
        pagina.get_by_role("button", name="Abrir coluna lateral").click()
        botao_nota(pagina, nota_a).click()
        pagina.locator(".cm-editor").wait_for(state="visible")
        pagina.get_by_role("button", name="Leitura", exact=True).click()
        pagina.locator("a.nota-link").first.click()
        pagina.locator(".cm-editor").wait_for(state="attached")
        verificar(108, "wikilink destaca nota e mantém ancestrais abertos",
                 botao_nota(pagina, nota_b).get_attribute("aria-current") == "page"
                 and all(pagina.locator(f'.lateral-pasta[data-caminho="{c}"]').get_attribute("aria-expanded") == "true" for c in ancestrais))
        pagina.evaluate("""() => {
          window.__cliquesLateral = 0;
          window.__rolagensLateral = 0;
          window.addEventListener('click', () => window.__cliquesLateral++, true);
          window.addEventListener('scroll', () => window.__rolagensLateral++, true);
        }""")
        pasta_p3 = pagina.locator('.lateral-pasta[data-caminho="Medicina/Matérias Básicas/Genética/P3"]')
        pasta_p3.click()
        pasta_p3.click()
        pagina.locator(".lateral-arvore").evaluate("el => { el.scrollTop += 100; }")
        pagina.wait_for_function("() => window.__rolagensLateral > 0")
        atividade = pagina.evaluate("() => ({cliques: window.__cliquesLateral, rolagens: window.__rolagensLateral})")
        verificar(117, "clique e rolagem da lateral chegam à janela", atividade["cliques"] >= 2 and atividade["rolagens"] > 0 and not erros, str(atividade))
    finally:
        contexto.close()

    contexto, pagina, erros_mobile = abrir_contexto(390)
    try:
        verificar(109, "telefone inicia com lateral fechada", pagina.locator(".lateral").is_hidden())
        x_antes = pagina.locator(".app-conteudo").evaluate("el => el.getBoundingClientRect().x")
        pagina.get_by_role("button", name="Abrir coluna lateral").click()
        x_depois = pagina.locator(".app-conteudo").evaluate("el => el.getBoundingClientRect().x")
        verificar(115, "gaveta sobreposta sem deslocar conteúdo", x_antes == x_depois and pagina.locator(".lateral").is_visible())
        if screenshot:
            destino_mobile = Path(screenshot).with_name("lateral-telefone.png")
            pagina.screenshot(path=str(destino_mobile), full_page=False)
            print(f"INFO  print telefone: {destino_mobile}")
        pagina.mouse.click(350, 300)
        verificar(116, "clique real no fundo fecha a gaveta", pagina.locator(".lateral").is_hidden())
        pagina.get_by_role("button", name="Abrir coluna lateral").click()
        pagina.locator(".botao-lateral").focus()
        alcancou_arvore = False
        for _ in range(8):
            pagina.keyboard.press("Tab")
            if pagina.evaluate("() => document.activeElement?.classList.contains('lateral-item')"):
                alcancou_arvore = True
                break
        pagina.keyboard.press("Escape")
        verificar(118, "Tab alcança árvore; Escape fecha gaveta; aria-expanded acompanha", alcancou_arvore and pagina.locator(".lateral").is_hidden()
                 and pagina.locator(".botao-lateral").get_attribute("aria-expanded") == "false")
        pagina.get_by_role("button", name="Abrir coluna lateral").click()
        for caminho in ["Medicina", "Medicina/Matérias Básicas", "Medicina/Matérias Básicas/Genética", "Medicina/Matérias Básicas/Genética/P3"]:
            pagina.locator(f'.lateral-pasta[data-caminho="{caminho}"]').click()
        botao_nota(pagina, nota_a).click()
        pagina.locator(".cm-editor").wait_for(state="visible")
        verificar(115, "escolher nota fecha a gaveta", pagina.locator(".lateral").is_hidden() and not erros_mobile)
    finally:
        contexto.close()

    return not falhas
