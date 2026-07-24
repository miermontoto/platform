// cliente oidc (relying party) compartido por las apps de la plataforma. flujo
// authorization code + pkce contra un emisor oidc (mier.info); verifica el id_token
// contra el jwks del emisor con jose. es agnóstico al transporte: beginLogin devuelve
// el state/verifier/nonce y cada app decide dónde guardarlos (cookie httpOnly corta),
// y completeLogin los recibe de vuelta. las apps mantienen su propia sesión local.
import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface OidcConfig {
  // emisor, p.ej. https://id.mier.info (sin barra final; se normaliza igual)
  issuer: string;
  clientId: string;
  clientSecret: string;
  // callback registrado en el cliente, p.ej. https://app/api/auth/oidc/callback
  redirectUri: string;
  // scopes solicitados; por defecto identidad + perfil + email
  scopes?: string;
}

export interface OidcClaims {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
  // id_token crudo, por si la app quiere guardarlo para el end_session (logout global)
  idToken: string;
}

// datos que la app persiste entre beginLogin y el callback (cookie corta httpOnly)
export interface LoginStart {
  url: string;
  state: string;
  codeVerifier: string;
  nonce: string;
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
}

export interface OidcClient {
  beginLogin(opts?: { prompt?: string; maxAge?: number }): Promise<LoginStart>;
  completeLogin(params: {
    code: string;
    state: string;
    expectedState: string;
    codeVerifier: string;
    nonce: string;
  }): Promise<OidcClaims>;
  endSessionUrl(opts: {
    idTokenHint?: string;
    postLogoutRedirectUri?: string;
    state?: string;
  }): Promise<string | null>;
}

const b64url = (buf: Buffer): string => buf.toString('base64url');

export function createOidcClient(cfg: OidcConfig): OidcClient {
  const scopes = cfg.scopes ?? 'openid profile email';
  const issuer = cfg.issuer.replace(/\/$/, '');
  // discovery + jwks se cachean tras la primera llamada (jose refresca el jwks solo)
  let discovery: Discovery | null = null;
  let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  async function discover(): Promise<Discovery> {
    if (discovery && jwks) return discovery;
    const res = await fetch(`${issuer}/.well-known/openid-configuration`);
    if (!res.ok) throw new Error(`oidc discovery: ${res.status}`);
    discovery = (await res.json()) as Discovery;
    jwks = createRemoteJWKSet(new URL(discovery.jwks_uri));
    return discovery;
  }

  return {
    async beginLogin(opts = {}) {
      const d = await discover();
      const state = b64url(randomBytes(32));
      const nonce = b64url(randomBytes(32));
      const codeVerifier = b64url(randomBytes(32));
      const codeChallenge = b64url(createHash('sha256').update(codeVerifier).digest());
      const params = new URLSearchParams({
        client_id: cfg.clientId,
        redirect_uri: cfg.redirectUri,
        response_type: 'code',
        scope: scopes,
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });
      // prompt=login / max_age para re-autenticación forzada (step-up)
      if (opts.prompt) params.set('prompt', opts.prompt);
      if (opts.maxAge !== undefined) params.set('max_age', String(opts.maxAge));
      return { url: `${d.authorization_endpoint}?${params.toString()}`, state, codeVerifier, nonce };
    },

    async completeLogin({ code, state, expectedState, codeVerifier, nonce }) {
      // binding de navegador: el state de la url debe igualar el que guardó la app
      if (!state || state !== expectedState) throw new Error('oidc: state no coincide');
      const d = await discover();
      const auth = Buffer.from(
        `${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`,
      ).toString('base64');
      const res = await fetch(d.token_endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${auth}`,
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: cfg.redirectUri,
          code_verifier: codeVerifier,
        }),
      });
      if (!res.ok) throw new Error(`oidc token: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
      const tokens = (await res.json()) as { id_token?: string };
      if (!tokens.id_token) throw new Error('oidc: respuesta sin id_token');
      const { payload } = await jwtVerify(tokens.id_token, jwks!, { issuer: d.issuer, audience: cfg.clientId });
      if (nonce && payload.nonce !== nonce) throw new Error('oidc: nonce no coincide');
      if (!payload.sub) throw new Error('oidc: id_token sin sub');
      return {
        sub: String(payload.sub),
        email: typeof payload.email === 'string' ? payload.email.toLowerCase() : null,
        emailVerified: payload.email_verified === true,
        name: typeof payload.name === 'string' ? payload.name : null,
        picture: typeof payload.picture === 'string' ? payload.picture : null,
        idToken: tokens.id_token,
      };
    },

    async endSessionUrl({ idTokenHint, postLogoutRedirectUri, state }) {
      const d = await discover();
      if (!d.end_session_endpoint) return null;
      const params = new URLSearchParams();
      if (idTokenHint) params.set('id_token_hint', idTokenHint);
      if (postLogoutRedirectUri) params.set('post_logout_redirect_uri', postLogoutRedirectUri);
      if (state) params.set('state', state);
      const q = params.toString();
      return q ? `${d.end_session_endpoint}?${q}` : d.end_session_endpoint;
    },
  };
}
