/**
 * Client HTTP minimal : cookies par domaine, redirections, délai maximum, nouvelles tentatives.
 * Les portails de type Atexo/PRADO exigent la conservation des cookies de session entre les pages.
 */
export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 Vigie/1.0';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class HttpError extends Error {
  constructor(message, { status, url } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
  }
}

function charsetFrom(contentType = '', bytes) {
  const header = /charset=["']?([\w-]+)/i.exec(contentType);
  if (header) return header[1].toLowerCase();
  const head = Buffer.from(bytes.slice(0, 4096)).toString('latin1');
  const meta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head) || /<\?xml[^>]+encoding=["']([\w-]+)/i.exec(head);
  return meta ? meta[1].toLowerCase() : 'utf-8';
}

function decode(bytes, contentType) {
  const charset = charsetFrom(contentType, bytes);
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

export function createHttpClient({ userAgent = DEFAULT_USER_AGENT, timeoutMs = 45000, retries = 2, delayMs = 400 } = {}) {
  const jars = new Map();
  let lastRequestAt = 0;

  const jarFor = (url) => {
    const host = new URL(url).hostname;
    if (!jars.has(host)) jars.set(host, new Map());
    return jars.get(host);
  };

  const storeCookies = (url, response) => {
    const jar = jarFor(url);
    for (const cookie of response.headers.getSetCookie?.() ?? []) {
      const [pair] = cookie.split(';');
      const index = pair.indexOf('=');
      if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  };

  const cookieHeader = (url) => [...jarFor(url)].map(([key, value]) => `${key}=${value}`).join('; ');

  async function once(url, { method = 'GET', body, headers = {} }) {
    // Politesse : un léger délai entre deux requêtes successives.
    const wait = lastRequestAt + delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();

    let currentUrl = url;
    let currentMethod = method;
    let currentBody = body;
    for (let hop = 0; hop < 8; hop += 1) {
      const response = await fetch(currentUrl, {
        method: currentMethod,
        body: currentBody,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'User-Agent': userAgent,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/rss+xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.7',
          ...(cookieHeader(currentUrl) ? { Cookie: cookieHeader(currentUrl) } : {}),
          ...headers,
        },
      });
      storeCookies(currentUrl, response);
      if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
        currentUrl = new URL(response.headers.get('location'), currentUrl).href;
        if (response.status !== 307 && response.status !== 308) {
          currentMethod = 'GET';
          currentBody = undefined;
        }
        continue;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      const text = decode(bytes, response.headers.get('content-type') || '');
      if (response.status >= 400) {
        throw new HttpError(`Le site a répondu ${response.status} (${response.statusText || 'erreur'})`, {
          status: response.status,
          url: currentUrl,
        });
      }
      return { url: currentUrl, status: response.status, headers: response.headers, text };
    }
    throw new HttpError('Trop de redirections', { url });
  }

  async function request(url, options = {}) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await once(url, options);
      } catch (error) {
        lastError = error;
        const retryable = !(error instanceof HttpError) || error.status === 429 || error.status >= 500;
        if (!retryable || attempt === retries) break;
        await sleep(1500 * (attempt + 1));
      }
    }
    throw humanize(lastError, url);
  }

  return {
    get: (url, options = {}) => request(url, { ...options, method: 'GET' }),
    post: (url, body, options = {}) =>
      request(url, {
        ...options,
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(options.headers || {}) },
      }),
  };
}

function humanize(error, url) {
  if (error instanceof HttpError) return error;
  const cause = error?.cause?.code || error?.code || '';
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  })();
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return new HttpError(`Le site ${host} n'a pas répondu à temps`, { url });
  if (cause === 'ENOTFOUND' || cause === 'EAI_AGAIN') return new HttpError(`Adresse introuvable : ${host}`, { url });
  if (cause === 'ECONNREFUSED' || cause === 'ECONNRESET') return new HttpError(`Connexion refusée par ${host}`, { url });
  if (String(cause).startsWith('ERR_TLS') || String(cause).includes('CERT')) return new HttpError(`Certificat de sécurité invalide pour ${host}`, { url });
  return new HttpError(`Impossible de joindre ${host} (${cause || error?.message || 'erreur réseau'})`, { url });
}
