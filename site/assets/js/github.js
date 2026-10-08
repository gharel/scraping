/**
 * Accès à l'API GitHub avec un jeton personnel (stocké uniquement sur cet appareil).
 * Sert à enregistrer la configuration depuis la version en ligne et à lancer une vérification.
 */
export class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function decodeBase64(value) {
  const binary = atob(String(value || '').replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

function explain(status, data, repository) {
  const message = String(data?.message || '');
  if (status === 401) return 'GitHub refuse ce jeton : il est expiré, révoqué ou mal copié.';
  if (status === 403 && /rate limit/i.test(message)) return 'Trop de requêtes vers GitHub pour le moment. Réessayez dans quelques minutes.';
  if (status === 403) return `Ce jeton n’a pas les droits nécessaires sur ${repository} (Contents et Actions en lecture et écriture).`;
  if (status === 404) return `Dépôt introuvable : vérifiez que le jeton donne bien accès à ${repository}.`;
  if (status === 409) return 'La configuration a été modifiée entre-temps. Réessayez.';
  if (status === 422) return `GitHub a refusé la demande : ${message || 'données invalides'}.`;
  return `Erreur GitHub ${status}${message ? ` : ${message}` : ''}.`;
}

export function createGitHubClient({ token, repository, branch = 'main' }) {
  const base = `https://api.github.com/repos/${repository}`;

  async function call(path, { method = 'GET', body } = {}) {
    let response;
    try {
      response = await fetch(base + path, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
    } catch {
      throw new GitHubError('Impossible de joindre GitHub. Vérifiez votre connexion internet.', 0);
    }
    if (response.status === 204) return null;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new GitHubError(explain(response.status, data, repository), response.status);
    return data;
  }

  const contentPath = (path) => `/contents/${path.split('/').map(encodeURIComponent).join('/')}`;

  return {
    repository,
    branch,
    async check() {
      const repo = await call('');
      if (repo.permissions && !repo.permissions.push) {
        throw new GitHubError('Ce jeton peut lire le dépôt mais pas le modifier : accordez « Contents : Read and write ».', 403);
      }
      return repo;
    },
    async readText(path) {
      const file = await call(`${contentPath(path)}?ref=${encodeURIComponent(branch)}`);
      return { sha: file.sha, text: decodeBase64(file.content) };
    },
    async writeText(path, text, sha, message) {
      return call(contentPath(path), { method: 'PUT', body: { message, content: encodeBase64(text), sha, branch } });
    },
    async dispatch(workflow) {
      return call(`/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, { method: 'POST', body: { ref: branch } });
    },
    async lastRun(workflow) {
      const data = await call(`/actions/workflows/${encodeURIComponent(workflow)}/runs?per_page=1&branch=${encodeURIComponent(branch)}`);
      return data?.workflow_runs?.[0] || null;
    },
  };
}
