const API = "https://api.github.com";
const MAX_FILE_CHARS = 80_000;

function validName(value) {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,100}$/.test(value) && value !== "." && value !== "..";
}

function validRef(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value);
}

function apiPath(owner, repo, resource, path = "") {
  const base = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const suffix = resource ? `/${resource}` : "";
  const encodedPath = path ? `/${path.split("/").map(encodeURIComponent).join("/")}` : "";
  return base + suffix + encodedPath;
}

async function githubRequest(url, fetcher) {
  const response = await fetcher(url, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "BOR-AI"
    }
  });
  if (!response.ok) {
    if (response.status === 404) return { error: "Repository atau resource tidak ditemukan. BOR AI saat ini hanya membaca repository publik.", status: 404 };
    if (response.status === 403 && response.headers.get("X-RateLimit-Remaining") === "0") return { error: "Batas permintaan GitHub API tercapai. Coba lagi setelah kuota pulih.", status: 429 };
    if (response.status === 403 || response.status === 429) return { error: "GitHub menolak permintaan. Periksa akses repository atau coba lagi nanti.", status: 429 };
    return { error: "GitHub API sedang tidak tersedia.", status: response.status >= 500 ? 502 : 400 };
  }
  try {
    return { data: await response.json() };
  } catch {
    return { error: "Respons GitHub tidak valid.", status: 502 };
  }
}

function decodeContent(content) {
  try {
    const binary = atob(content.replace(/\s/g, ""));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function queryContext(url) {
  const owner = url.searchParams.get("owner");
  const repo = url.searchParams.get("repo");
  if (!validName(owner) || !validName(repo)) return { error: "Parameter owner dan repo wajib diisi dengan nama GitHub yang valid." };
  const ref = url.searchParams.get("ref");
  if (ref !== null && !validRef(ref)) return { error: "Referensi branch atau commit tidak valid." };
  const path = url.searchParams.get("path") || "";
  if (path.length > 500 || path.startsWith("/") || path.split("/").some((part) => part === "." || part === ".." || /[\u0000-\u001f\u007f]/.test(part))) {
    return { error: "Path repository tidak valid." };
  }
  return { owner, repo, ref, path };
}

function compactRepository(data) {
  return {
    id: data.id,
    name: data.name,
    fullName: data.full_name,
    description: data.description,
    private: data.private,
    htmlUrl: data.html_url,
    defaultBranch: data.default_branch,
    language: data.language,
    stars: data.stargazers_count,
    forks: data.forks_count,
    openIssues: data.open_issues_count,
    updatedAt: data.updated_at
  };
}

function compactEntry(item) {
  return {
    name: item.name,
    path: item.path,
    type: item.type,
    size: item.size,
    sha: item.sha,
    htmlUrl: item.html_url
  };
}

export async function handleGitHubReadRoute(request, env, url, { fetcher = fetch, json }) {
  if (request.method !== "GET") return json({ error: "GitHub Reader hanya mendukung GET." }, 405, { Allow: "GET" });
  const context = queryContext(url);
  if (context.error) return json({ error: context.error }, 400);

  const { owner, repo, ref, path } = context;
  const route = url.pathname;
  let endpoint;
  let transform;

  if (route === "/api/github/repository") {
    endpoint = apiPath(owner, repo);
    transform = compactRepository;
  } else if (route === "/api/github/tree") {
    endpoint = apiPath(owner, repo, "contents", path);
    transform = (data) => Array.isArray(data) ? data.map(compactEntry) : compactEntry(data);
  } else if (route === "/api/github/file") {
    if (!path) return json({ error: "Parameter path wajib diisi untuk membaca file." }, 400);
    endpoint = apiPath(owner, repo, "contents", path);
    transform = (data) => {
      if (data.type !== "file" || typeof data.content !== "string" || data.encoding !== "base64") return null;
      const content = decodeContent(data.content);
      if (content === null) return null;
      return {
        name: data.name,
        path: data.path,
        sha: data.sha,
        htmlUrl: data.html_url,
        content: content.slice(0, MAX_FILE_CHARS),
        truncated: content.length > MAX_FILE_CHARS
      };
    };
  } else if (route === "/api/github/commits") {
    endpoint = apiPath(owner, repo, "commits");
    transform = (data) => Array.isArray(data) ? data.slice(0, 30).map((item) => ({
      sha: item.sha,
      message: item.commit?.message,
      author: item.commit?.author?.name,
      date: item.commit?.author?.date,
      htmlUrl: item.html_url
    })) : null;
  } else if (route === "/api/github/branches") {
    endpoint = apiPath(owner, repo, "branches");
    transform = (data) => Array.isArray(data) ? data.slice(0, 100).map((item) => ({
      name: item.name,
      sha: item.commit?.sha,
      protected: item.protected
    })) : null;
  } else if (route === "/api/github/pulls") {
    endpoint = apiPath(owner, repo, "pulls");
    transform = (data) => Array.isArray(data) ? data.slice(0, 30).map((item) => ({
      number: item.number,
      title: item.title,
      state: item.state,
      draft: item.draft,
      user: item.user?.login,
      head: item.head?.ref,
      base: item.base?.ref,
      htmlUrl: item.html_url,
      updatedAt: item.updated_at
    })) : null;
  } else {
    return json({ error: "Endpoint GitHub Reader tidak ditemukan." }, 404);
  }

  const params = new URLSearchParams();
  if (ref) params.set(route === "/api/github/commits" ? "sha" : "ref", ref);
  if (route === "/api/github/commits" || route === "/api/github/branches" || route === "/api/github/pulls") {
    const perPage = Math.min(100, Math.max(1, Number(url.searchParams.get("per_page")) || 30));
    params.set("per_page", String(perPage));
  }
  if (route === "/api/github/pulls") {
    const state = url.searchParams.get("state") || "open";
    if (!["open", "closed", "all"].includes(state)) return json({ error: "State Pull Request tidak valid." }, 400);
    params.set("state", state);
  }
  const target = params.size ? `${endpoint}?${params}` : endpoint;
  const result = await githubRequest(target, fetcher);
  if (result.error) return json({ error: result.error }, result.status);
  const data = transform(result.data);
  if (data === null || data === undefined) return json({ error: "Format data GitHub tidak didukung oleh endpoint ini." }, 502);
  return json({ repository: `${owner}/${repo}`, data }, 200, { "Cache-Control": "public, max-age=60" });
}
