// Fetches and parses items from reputable, free RSS feeds using rss-parser.
// No API keys required — RSS feeds are public XML documents.

const Parser = require('rss-parser');
const { TOPICS } = require('../config/topics');
const { buildNormalizedItem } = require('../utils/normalize');

const FETCH_TIMEOUT_MS = 8000;

const parser = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: {
    // Some feeds (e.g. Cloudflare-protected ones) reject requests that
    // don't look like they come from a real client.
    'User-Agent': 'scoopr-app/1.0 (personal news aggregator; contact: dev@scoopr.local)'
  }
});

// RSS items don't have a single standard field for images, so try the
// common spots in order: <enclosure>, media:content, then a raw <img> tag
// inside the HTML content/description.
function extractImageUrl(item) {
  if (item.enclosure?.url) return item.enclosure.url;

  const mediaContent = item['media:content'];
  if (mediaContent?.$?.url) return mediaContent.$.url;
  if (Array.isArray(mediaContent) && mediaContent[0]?.$?.url) return mediaContent[0].$.url;

  const html = item['content:encoded'] || item.content || item.summary || '';
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

function normalizeRssItem(item, topic, feedUrl) {
  return buildNormalizedItem({
    sourceType: 'rss',
    sourceId: item.guid || item.id || item.link,
    title: item.title,
    url: item.link,
    imageUrl: extractImageUrl(item),
    topic,
    publishedAt: item.isoDate || item.pubDate || null,
    raw: { ...item, feedUrl }
  });
}

async function fetchFeed(feedUrl, topic) {
  const feed = await parser.parseURL(feedUrl);
  const items = feed.items || [];

  return items
    .filter((item) => item.link) // an item with no URL is useless downstream
    .map((item) => normalizeRssItem(item, topic, feedUrl));
}

// Fetches every RSS feed mapped to `topicKey` and returns one combined,
// normalized array. Individual feed failures are logged and skipped rather
// than failing the whole request.
async function fetchRssForTopic(topicKey) {
  const topicConfig = TOPICS[topicKey];
  if (!topicConfig) {
    throw new Error(`Unknown topic "${topicKey}"`);
  }

  const results = await Promise.allSettled(
    topicConfig.rssFeeds.map((feedUrl) => fetchFeed(feedUrl, topicKey))
  );

  const items = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      items.push(...result.value);
    } else {
      console.warn(
        `[rss] Failed to fetch ${topicConfig.rssFeeds[index]}:`,
        result.reason?.message || result.reason
      );
    }
  });

  return items;
}

module.exports = { fetchRssForTopic };
