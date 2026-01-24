export function buildQuery(
  base: string,
  params: Record<string, string | number | undefined | null>
) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    searchParams.set(key, String(value));
  });
  const query = searchParams.toString();
  return query ? `${base}?${query}` : base;
}
