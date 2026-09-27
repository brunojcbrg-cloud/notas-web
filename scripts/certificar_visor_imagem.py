"""Certifica no Edge o visor de imagem em tela cheia (§Z.2)."""
from __future__ import annotations

import base64
import json


CAMINHO = "06_Conhecimento/Genética/Visor E2E.md"
ANEXO = "06_Conhecimento/_anexos/visor-e2e.png"

# PNG 2x2, para o <img> do visor carregar de verdade.
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP8z4AAT"
    "AxQMEgYAAAA//8DAAN+AP9Z3ZaKAAAAAElFTkSuQmCC"
)

NOTA = "# Visor E2E\n\n![[visor-e2e.png]]\n"


def certificar(navegador, url: str) -> bool:
    falhas: list[str] = []

    def verificar(caso: int, titulo: str, passou: bool, detalhe: str = "") -> None:
        print(f"{'OK' if passou else 'FALHA'} {caso}. {titulo}{'; ' + detalhe if detalhe else ''}")
        if not passou:
            falhas.append(str(caso))

    contexto = navegador.new_context(viewport={"width": 1280, "height": 900})
    pagina = contexto.new_page()
    erros: list[str] = []
    pagina.on("pageerror", lambda erro: erros.append(str(erro)))

    def github(rota) -> None:
        req = rota.request
        if "/git/trees/master" in req.url:
            rota.fulfill(
                status=200, content_type="application/json",
                body=json.dumps({"sha": "tree-visor", "tree": [{"path": CAMINHO, "type": "blob", "sha": "sha-visor"}]}),
            )
        elif "_anexos/" in req.url:
            rota.fulfill(
                status=200, content_type="application/json",
                body=json.dumps({"content": base64.b64encode(PNG).decode("ascii"), "encoding": "base64", "sha": "sha-png"}),
            )
        elif "_anexos" in req.url:
            rota.fulfill(status=200, content_type="application/json", body=json.dumps([{"type": "file", "path": ANEXO}]))
        elif "/contents/" in req.url and req.method == "GET":
            rota.fulfill(
                status=200, content_type="application/json",
                body=json.dumps({"content": base64.b64encode(NOTA.encode("utf-8")).decode("ascii"), "sha": "sha-visor"}),
            )
        else:
            rota.fulfill(status=404, content_type="application/json", body="{}")

    try:
        pagina.route("https://api.github.com/**", github)
        pagina.goto(url, wait_until="networkidle", timeout=30_000)
        pagina.locator("#token").fill("github_pat_E2E_VISOR")
        pagina.get_by_role("button", name="Entrar", exact=True).click()
        pagina.locator(".lista-corpo").wait_for(state="visible")

        pagina.get_by_role("searchbox", name="Filtrar notas por nome").fill("Visor E2E")
        pagina.locator(".item-nota").first.click()
        pagina.locator(".cm-editor").wait_for(state="visible")
        pagina.get_by_role("button", name="Leitura", exact=True).click()
        pagina.locator("img.nota-imagem").first.wait_for(state="visible", timeout=10_000)
        pagina.wait_for_timeout(500)

        pagina.locator("img.nota-imagem").first.click()
        visor = pagina.locator(".visor-imagem-fundo")
        visor.wait_for(state="visible", timeout=10_000)
        src_visor = pagina.locator(".visor-imagem-img").get_attribute("src") or ""
        verificar(
            239, "clicar na imagem do modo leitura abre o visor com a mesma imagem",
            src_visor.startswith("data:image/") and not erros,
            f"src: {src_visor[:20]}...",
        )

        pagina.keyboard.press("Escape")
        visor.wait_for(state="hidden", timeout=5_000)
        verificar(240, "Esc fecha o visor", pagina.locator(".visor-imagem-fundo").count() == 0)

        pagina.locator("img.nota-imagem").first.click()
        visor.wait_for(state="visible", timeout=10_000)
        pagina.go_back()
        visor.wait_for(state="hidden", timeout=5_000)
        nota_continua = pagina.locator(".leitura-markdown").is_visible() and pagina.locator("img.nota-imagem").count() > 0
        verificar(
            241, "voltar do navegador fecha o visor sem sair da nota",
            nota_continua and not erros,
        )

        return not falhas
    finally:
        contexto.close()
