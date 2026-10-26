/** Standalone so the docs injector can emit the same filter without a second policy. */
export function createMetricsFilter(publicPaths) {
  const paths = new Set(publicPaths);
  return (event) => {
    try {
      const current = new URL(globalThis.location.href);
      const url = new URL(event.url, current.origin);
      if (!paths.has(current.pathname) || !paths.has(url.pathname)
        || url.origin !== current.origin || url.username || url.password
        || (event.type !== "pageview" && event.type !== "vital")) return null;

      const referrer = globalThis.document?.referrer;
      if (referrer) {
        const from = new URL(referrer);
        if (from.username || from.password || from.search || from.hash
          || (from.pathname !== "/" && (from.origin !== current.origin || !paths.has(from.pathname)))) return null;
      }

      return { ...event, url: url.origin + url.pathname };
    } catch {
      return null;
    }
  };
}
