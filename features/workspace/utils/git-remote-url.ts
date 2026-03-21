/**
 * Convert a git remote URL (SSH or HTTPS) into a browser-friendly URL.
 * Returns null if the URL cannot be parsed or is not a known host.
 */
export function gitRemoteToBrowserUrl(remoteUrl: string | null | undefined): {
  url: string;
  host: 'github' | 'gitlab' | 'bitbucket' | 'other';
  label: string;
} | null {
  if (!remoteUrl) return null;

  let cleaned = remoteUrl.trim();

  // SSH format: git@github.com:user/repo.git
  const sshMatch = cleaned.match(
    /^(?:ssh:\/\/)?git@([^:/]+)[:/](.+?)(?:\.git)?$/,
  );
  if (sshMatch) {
    const [, hostRaw, path] = sshMatch;
    const host = hostRaw.toLowerCase();
    const browserUrl = `https://${host}/${path}`;
    return { url: browserUrl, ...classifyHost(host) };
  }

  // HTTPS format: https://github.com/user/repo.git
  const httpsMatch = cleaned.match(
    /^https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/,
  );
  if (httpsMatch) {
    const [, hostRaw, path] = httpsMatch;
    const host = hostRaw.toLowerCase();
    const browserUrl = `https://${host}/${path}`;
    return { url: browserUrl, ...classifyHost(host) };
  }

  return null;
}

function classifyHost(host: string): {
  host: 'github' | 'gitlab' | 'bitbucket' | 'other';
  label: string;
} {
  if (host.includes('github')) {
    return { host: 'github', label: 'GitHub' };
  }
  if (host.includes('gitlab')) {
    return { host: 'gitlab', label: 'GitLab' };
  }
  if (host.includes('bitbucket')) {
    return { host: 'bitbucket', label: 'Bitbucket' };
  }
  return { host: 'other', label: host };
}
