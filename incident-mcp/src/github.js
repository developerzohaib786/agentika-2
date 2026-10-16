// Deploy history = commits on the backend repo (optionally only those touching
// BACKEND_PATH). Alternate Clouds rebuilds the service from these commits, so
// each one is a deploy candidate / rollback target.
const GITHUB_REPO = process.env.GITHUB_REPO || ''; // owner/name
const GITHUB_PAT = process.env.GITHUB_PAT || '';
// Subfolder holding the backend; empty = whole repo.
const BACKEND_PATH = process.env.BACKEND_PATH ?? 'backend';

async function backendCommits(limit) {
  if (!GITHUB_REPO) throw new Error('GITHUB_REPO is not set (owner/name)');
  const qs = new URLSearchParams({ per_page: String(limit) });
  if (BACKEND_PATH) qs.set('path', BACKEND_PATH);
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/commits?${qs}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'agentika-incident-mcp',
      ...(GITHUB_PAT ? { Authorization: `Bearer ${GITHUB_PAT}` } : {}),
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const commits = await res.json();
  return commits.map((c) => ({
    sha: c.sha,
    shortSha: c.sha.slice(0, 7),
    message: c.commit.message.split('\n')[0],
    author: c.commit.author?.name,
    date: c.commit.author?.date,
    url: c.html_url,
  }));
}

module.exports = { backendCommits, GITHUB_REPO };
