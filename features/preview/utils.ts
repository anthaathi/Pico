import type { PreviewTarget } from "@/features/preview/store";

function normalizePath(path?: string) {
  if (!path) {
    return { pathname: "", search: "" };
  }

  const trimmed = path.trim();
  if (!trimmed) {
    return { pathname: "", search: "" };
  }

  const [pathnamePart, searchPart] = trimmed.split("?", 2);
  const normalizedPathname = pathnamePart
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return {
    pathname: normalizedPathname,
    search: searchPart ? `?${searchPart}` : "",
  };
}

export function buildPreviewUrl(params: {
  serverUrl: string;
  accessToken?: string;
  sessionId: string;
  target: PreviewTarget;
}) {
  const { pathname, search } = normalizePath(params.target.path);
  const basePath = `${params.serverUrl}/api/agent/sessions/${params.sessionId}/preview/${encodeURIComponent(params.target.hostname)}/${params.target.port}`;
  const url = new URL(pathname ? `${basePath}/${pathname}` : `${basePath}/`);
  if (search) {
    url.search = search;
  }
  if (params.accessToken) {
    url.searchParams.set("access_token", params.accessToken);
  }
  return url.toString();
}
