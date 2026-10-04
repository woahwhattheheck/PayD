/** Parse a scalar Express route parameter without coercing wildcard arrays. */
export function parseRouteInteger(value: string | string[] | undefined): number {
  return typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
}
