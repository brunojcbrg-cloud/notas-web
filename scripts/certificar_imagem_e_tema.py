"""Certificação da imagem no modo ao vivo e do tema guardado no vault, no Edge.

Casos 153-159. Respostas do GitHub em memória: nenhuma chamada sai da máquina.
"""
from __future__ import annotations

import base64
import json


PASTA = "06_Conhecimento/Medicina/Matérias Básicas/Neuroanatomia/"
CAMINHO = PASTA + "Introdução à neuroanatomia.md"
ANEXO = "06_Conhecimento/_anexos/Pasted image 20260921104135.png"
PREFERENCIAS = "05_Sistema/notas-web/preferencias.json"

# PNG 2x2, para `naturalWidth` provar que a imagem decodificou de verdade.
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP8z4AAT"
    "AxQMEgYAAAA//8DAAN+AP9Z3ZaKAAAAAElFTkSuQmCC"
)

NOTA = (
    "![[Pasted image 20260921104135.png]]\n"
    "\n"
    "- resposta final.![[Pasted image 20260921104135.png|496]]\n"
    "- e uma que sumiu: ![[nao existe.png]]\n"
)


def certificar(navegador, url: str) -> bool:
    falhas: list[str] = []

    def verificar(caso: int, titulo: str, passou: bool, detalhe: str = "") -> None:
        print(f"{'OK' if passou else 'FALHA'} {caso}. {titulo}{'; ' + detalhe if detalhe else ''}")
        if not passou:
            falhas.append(str(caso))

    def abrir(preferencia_remota, tema_local):
        contexto = navegador.new_context(viewport={"width": 1280, "height": 900})
        if tema_local is not None:
            contexto.add_init_script(
                "window.localStorage.setItem('notas-web.markdown-theme', "
                + json.dumps(json.dumps(tema_local))
                + ");"
            )
        pagina = contexto.new_page()
        erros = []
        gravacoes = []
        pagina.on("pageerror", lambda erro: erros.append(str(erro)))

        def responder(rota) -> None:
            req = rota.request

            def json_ok(dados) -> None:
                rota.fulfill(
                    status=200,
                    content_type="application/json",
                    body=json.dumps(dados),
                )

            if "/git/trees/master" in req.url:
                json_ok(
                    {
                        "sha": "tree-e2e",
                        "tree": [{"path": CAMINHO, "type": "blob", "sha": "sha-e2e"}],
                    }
                )
            elif "preferencias.json" in req.url:
                if req.method == "PUT":
                    corpo = req.post_data_json
                    gravacoes.append(
                        (PREFERENCIAS, base64.b64decode(corpo["content"]).decode("utf-8"))
                    )
                    json_ok({"content": {"sha": "sha-pref"}})
                elif preferencia_remota is None:
                    rota.fulfill(status=404, content_type="application/json", body="{}")
                else:
                    json_ok(
                        {
                            "content": base64.b64encode(
                                json.dumps(preferencia_remota).encode("utf-8")
                            ).decode("ascii"),
                            "sha": "sha-pref",
                        }
                    )
            elif "_anexos/" in req.url:
                json_ok(
                    {
                        "content": base64.b64encode(PNG).decode("ascii"),
                        "encoding": "base64",
                        "sha": "sha-png",
                    }
                )
            elif "_anexos" in req.url:
                json_ok([{"type": "file", "path": ANEXO}])
            elif "/contents/" in req.url and req.method == "GET":
                json_ok(
                    {
                        "content": base64.b64encode(NOTA.encode("utf-8")).decode("ascii"),
                        "sha": "sha-e2e",
                    }
                )
            elif "/contents/" in req.url and req.method == "PUT":
                json_ok({"content": {"sha": "sha-novo"}})
            else:
                rota.fulfill(status=404, content_type="application/json", body="{}")

        pagina.route("https://api.github.com/**", responder)
        pagina.goto(url, wait_until="networkidle", timeout=30_000)
        pagina.locator("#token").fill("github_pat_E2E_LOCAL")
        pagina.get_by_role("button", name="Entrar").click()
        return contexto, pagina, erros, gravacoes

    def abrir_nota(pagina) -> None:
        pagina.get_by_role("searchbox", name="Filtrar notas por nome").fill(
            "Introdução à neuroanatomia"
        )
        pagina.locator(".item-nota").first.click()
        pagina.locator(".cm-editor").wait_for(state="visible")
        pagina.get_by_role("button", name="Ao vivo", exact=True).click()

    medidas_js = """() => [...document.querySelectorAll('img.cm-lp-imagem')].map((img) => ({
        largura: img.naturalWidth,
        estilo: img.style.width,
        faltante: img.classList.contains('cm-lp-imagem-faltante'),
        fonte: (img.getAttribute('src') || '').slice(0, 11),
    }))"""

    # --- imagem no modo ao vivo --------------------------------------------
    contexto, pagina, erros, _ = abrir(None, None)
    try:
        abrir_nota(pagina)
        # O cursor nasce na linha 1, que é o embed: ela tem de mostrar o cru.
        cru_com_cursor = "![[" in pagina.locator(".cm-line").first.inner_text()
        # A linha 2 é a vazia: com o cursor nela nenhuma linha de imagem é tocada.
        pagina.locator(".cm-line").nth(1).click()
        pagina.locator("img.cm-lp-imagem").first.wait_for(state="visible", timeout=10_000)
        pagina.wait_for_timeout(500)
        medidas = pagina.evaluate(medidas_js)
        desenhadas = [m for m in medidas if not m["faltante"]]
        verificar(
            153,
            "embed de imagem desenha no ao vivo, com os bytes do anexo",
            len(desenhadas) == 2
            and all(m["largura"] == 2 for m in desenhadas)
            and all(m["fonte"] == "data:image/" for m in desenhadas),
            f"desenhadas: {len(desenhadas)}; naturalWidth: {[m['largura'] for m in desenhadas]}",
        )
        verificar(
            154,
            "a linha do cursor mostra o cru, e a linha longe dele mostra a imagem",
            cru_com_cursor and len(medidas) == 3,
            f"cru na linha tocada: {cru_com_cursor}; imagens na tela: {len(medidas)}",
        )
        verificar(
            155,
            "o rótulo |496 vira largura, igual ao modo leitura",
            any(m["estilo"] == "496px" for m in desenhadas),
            f"larguras: {[m['estilo'] for m in desenhadas]}",
        )
        verificar(
            156,
            "anexo que não existe sai marcado, não some da tela",
            any(m["faltante"] for m in medidas),
            f"faltantes: {sum(1 for m in medidas if m['faltante'])}",
        )
        pagina.get_by_role("button", name="Fonte", exact=True).click()
        fonte = pagina.locator(".cm-content").inner_text()
        verificar(
            157,
            "o texto do embed continua no documento, intacto",
            fonte.count("![[Pasted image 20260921104135.png") == 2 and not erros,
            f"embeds no texto: {fonte.count('![[')}; erros JS: {len(erros)}",
        )
    finally:
        contexto.close()

    # --- tema no vault ------------------------------------------------------
    contexto, pagina, erros, gravacoes = abrir(None, {"tema": "padrao", "modo": "light"})
    try:
        pagina.locator(".tema-controles select").first.select_option("solarized")
        pagina.wait_for_timeout(2000)
        gravado = json.loads(gravacoes[0][1]) if gravacoes else {}
        verificar(
            158,
            "trocar o tema grava a preferência no vault, fora da pasta de notas",
            bool(gravacoes)
            and gravado.get("tema") == "solarized"
            and not gravacoes[0][0].startswith("06_Conhecimento/"),
            f"gravações: {len(gravacoes)}; conteúdo: {gravado}",
        )
    finally:
        contexto.close()

    contexto, pagina, erros, _ = abrir(
        {"tema": "solarized", "modo": "dark"}, {"tema": "padrao", "modo": "light"}
    )
    try:
        pagina.wait_for_function(
            "() => document.documentElement.dataset.temaMarkdown === 'solarized'",
            timeout=10_000,
        )
        seletor = pagina.locator(".tema-controles select").first.input_value()
        modo = pagina.evaluate("() => document.documentElement.dataset.modoCor")
        verificar(
            159,
            "o tema do vault vence o do navegador na abertura, e aparece no seletor",
            seletor == "solarized" and modo == "dark" and not erros,
            f"seletor: {seletor}; modo: {modo}; erros JS: {len(erros)}",
        )
    finally:
        contexto.close()

    if falhas:
        print("FALHAS:", ", ".join(falhas))
    return not falhas
