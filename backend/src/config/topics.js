// Central mapping of Scoopr topics -> raw sources (subreddits + RSS feeds).
// Both the Reddit and RSS services read from this file, so adding/removing a
// source for a topic only needs to happen in one place.

const TOPICS = {
  tech: {
    label: 'Tech',
    subreddits: ['technology', 'programming', 'gadgets'],
    rssFeeds: [
      'https://feeds.arstechnica.com/arstechnica/index',
      'https://www.theverge.com/rss/index.xml',
      'https://techcrunch.com/feed/'
    ]
  },
  sports: {
    label: 'Sports',
    subreddits: ['sports', 'nba', 'soccer'],
    rssFeeds: [
      'https://www.espn.com/espn/rss/news',
      'https://feeds.bbci.co.uk/sport/rss.xml'
    ]
  },
  finance: {
    label: 'Finance',
    subreddits: ['finance', 'investing'],
    rssFeeds: [
      'https://feeds.content.dowjones.io/public/rss/RSSMarketsMain',
      'https://feeds.marketwatch.com/marketwatch/topstories/'
    ]
  },
  entertainment: {
    label: 'Entertainment',
    subreddits: ['entertainment', 'movies', 'television'],
    rssFeeds: [
      'https://variety.com/feed/',
      'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml'
    ]
  },
  general: {
    label: 'General News',
    subreddits: ['news', 'worldnews'],
    rssFeeds: [
      'https://feeds.bbci.co.uk/news/rss.xml',
      'https://feeds.npr.org/1001/rss.xml'
    ]
  }
};

// Accept a few friendly aliases so the ?topic= query param is forgiving
// (e.g. "general-news" or "world" both resolve to the "general" topic).
const ALIASES = {
  technology: 'tech',
  'general-news': 'general',
  generalnews: 'general',
  news: 'general',
  world: 'general'
};

function resolveTopicKey(rawTopic) {
  if (!rawTopic) return null;
  const key = String(rawTopic).trim().toLowerCase();
  if (TOPICS[key]) return key;
  if (ALIASES[key]) return ALIASES[key];
  return null;
}

module.exports = { TOPICS, resolveTopicKey };
