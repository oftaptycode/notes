// Use local Date getters, not UTC or a locale-dependent date order.
export function formatCreatedAt(timestamp: number): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return 'Created: unknown';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `Created: ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
