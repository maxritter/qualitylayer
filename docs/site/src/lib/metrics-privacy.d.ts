export function createMetricsFilter(publicPaths: readonly string[]): <T extends {
  type: string;
  url: string;
}>(event: T) => T | null;
