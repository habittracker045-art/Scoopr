// Shared shape every fetched item is normalized into, regardless of source.
//
// {
//   sourceType: "reddit" | "rss",
//   sourceId: string,       // stable unique id/url, used later for dedup
//   title: string,
//   url: string,
//   imageUrl: string | null,
//   topic: string,          // Scoopr topic key, e.g. "tech"
//   publishedAt: string,    // ISO timestamp
//   raw: object             // original payload, kept for debugging only
// }

function toIsoOrNow(value) {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function buildNormalizedItem({ sourceType, sourceId, title, url, imageUrl, topic, publishedAt, raw }) {
  return {
    sourceType,
    sourceId: String(sourceId),
    title: title ? String(title).trim() : '(untitled)',
    url,
    imageUrl: imageUrl || null,
    topic,
    publishedAt: toIsoOrNow(publishedAt),
    raw
  };
}

module.exports = { buildNormalizedItem, toIsoOrNow };
