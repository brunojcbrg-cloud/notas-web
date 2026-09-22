// Fase 3, §3.3: login Google via Identity Services (script carregado no
// index.html) e localização do passe.json no Drive dela. Escopo decidido
// em M0.3 (E:\CENTRAL\work\HANDOFF_M03_20260922.md): drive.readonly —
// medido com conta convidada, drive.file não alcança arquivo de terceiro
// compartilhado (a apostila/o passe são do Bruno, compartilhados com ela).
import type { Fetcher } from './github';

export const CLIENT_ID_GOOGLE = '636980128795-eirkcjfe277vatprtd1enoptfqik01us.apps.googleusercontent.com';
const ESCOPO_GOOGLE = 'openid email https://www.googleapis.com/auth/drive.readonly';

export class ErroLoginGoogle extends Error {}

interface RespostaTokenGoogle {
  access_token?: string;
  error?: string;
  scope?: string;
}

interface ClienteTokenGoogle {
  requestAccessToken(opcoes?: { prompt?: string }): void;
}

interface GoogleAccountsOAuth2 {
  initTokenClient(opcoes: {
    client_id: string;
    scope: string;
    callback: (resposta: RespostaTokenGoogle) => void;
  }): ClienteTokenGoogle;
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleAccountsOAuth2 } };
  }
}

export function googleDisponivel(): boolean {
  return typeof window !== 'undefined' && typeof window.google?.accounts?.oauth2?.initTokenClient === 'function';
}

/** Abre o consentimento do Google e devolve o access_token com escopo drive.readonly. */
export function solicitarTokenGoogle(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!googleDisponivel()) {
      reject(new ErroLoginGoogle('Login Google indisponível agora — a biblioteca do Google não carregou. Use o token colado.'));
      return;
    }
    try {
      const cliente = window.google!.accounts!.oauth2!.initTokenClient({
        client_id: CLIENT_ID_GOOGLE,
        scope: ESCOPO_GOOGLE,
        callback: (resposta) => {
          if (resposta.error || typeof resposta.access_token !== 'string') {
            reject(new ErroLoginGoogle('Consentimento do Google recusado ou cancelado.'));
            return;
          }
          if (!(resposta.scope ?? '').includes('drive.readonly')) {
            reject(
              new ErroLoginGoogle(
                'O Google entrou mas não concedeu acesso ao Drive. Tente de novo e marque a permissão de leitura do Drive na tela de consentimento.',
              ),
            );
            return;
          }
          resolve(resposta.access_token);
        },
      });
      cliente.requestAccessToken({ prompt: '' });
    } catch (erro) {
      reject(new ErroLoginGoogle(`Falha ao abrir o consentimento do Google: ${erro instanceof Error ? erro.message : String(erro)}`));
    }
  });
}

/** Localiza o passe.json compartilhado com a conta logada e devolve seu conteúdo bruto (ainda não validado). */
export async function localizarESolicitarPasse(accessToken: string, fetcher: Fetcher = fetch): Promise<unknown> {
  const consulta = encodeURIComponent("name='passe.json' and trashed=false");
  const busca = await fetcher(
    `https://www.googleapis.com/drive/v3/files?q=${consulta}&fields=files(id,name)&pageSize=10&spaces=drive`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!busca.ok) throw new ErroLoginGoogle(`Não consegui procurar o passe no Drive (HTTP ${busca.status}).`);
  const dados = (await busca.json()) as { files?: Array<{ id?: string; name?: string }> };
  const achados = (dados.files ?? []).filter((item): item is { id: string; name?: string } => typeof item.id === 'string');
  if (achados.length === 0) {
    throw new ErroLoginGoogle('Nenhum passe.json compartilhado com esta conta. Peça ao Bruno para provisionar o acesso.');
  }
  if (achados.length > 1) {
    throw new ErroLoginGoogle('Mais de um passe.json visível para esta conta — avise o Bruno antes de continuar.');
  }
  const resposta = await fetcher(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(achados[0].id)}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!resposta.ok) throw new ErroLoginGoogle(`Não consegui ler o passe.json (HTTP ${resposta.status}).`);
  try {
    return await resposta.json();
  } catch {
    throw new ErroLoginGoogle('passe.json não é um JSON válido.');
  }
}
