/** Standalone so the docs injector can emit the same filter without a second policy. */
export function createMetricsFilter(publicPaths) {
  const paths = new Set(publicPaths);
  const hasCreds = (u) => Boolean(u.username || u.password);
  const sameOriginPublic = (current, url) =>
    paths.has(current.pathname) && paths.has(url.pathname) && url.origin === current.origin && !hasCreds(url);
  const isTrackableType = (event) => event.type === "pageview" || event.type === "vital";
  const isCleanUrl = (u) => !hasCreds(u) && !u.search && !u.hash;
  const isAllowedReferrer = (referrer, current) => {
    const from = new URL(referrer);
    const allowedPath = from.pathname === "/" || (from.origin === current.origin && paths.has(from.pathname));
    return isCleanUrl(from) && allowedPath;
  };
  return (event) => {
    try {
      const current = new URL(globalThis.location.href);
      const url = new URL(event.url, current.origin);
      if (!sameOriginPublic(current, url) || !isTrackableType(event)) return null;

      const referrer = globalThis.document?.referrer;
      if (referrer && !isAllowedReferrer(referrer, current)) return null;

      return { ...event, url: url.origin + url.pathname };
    } catch {
      return null;
    }
  };
}
