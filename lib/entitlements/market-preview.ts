/** Free Compare Books preview. Counts/range only — never names a best book. */
export function formatMarketRangePreview(
  bookCount: number | null | undefined,
  minLine: number | null | undefined,
  maxLine: number | null | undefined
): string {
  const count = bookCount != null && Number.isFinite(bookCount) ? Math.max(0, Math.trunc(bookCount)) : null;
  const books = count == null ? 'books' : `${count} ${count === 1 ? 'book' : 'books'}`;
  if (minLine == null || maxLine == null || !Number.isFinite(minLine) || !Number.isFinite(maxLine)) {
    return books;
  }
  return `${books} · market range ${minLine}–${maxLine}`;
}
