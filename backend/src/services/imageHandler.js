// Image handling — Phase 2, Prompt 4.
// Updated in the Redesign Phase (R1) to match the app's strict monochrome
// design system — see the note above TOPIC_COLORS below.
//
// For each item: if it already has an image URL (Reddit/RSS/HN often
// provide one), use it as-is. Otherwise render a simple templated fallback
// graphic — a monochrome card with the title on it — using `sharp`
// (renders an SVG string to PNG). No paid AI image generation here; that's
// a later phase if it ever happens.
//
// Resilience contract: like geminiCaption, this never throws. If fallback
// generation fails for any reason (bad install, disk issue, etc.), it logs
// a warning and resolves to `null` — `cards.image_url` is nullable, so a
// broken image renderer degrades gracefully instead of crashing the
// pipeline.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let sharp;
try {
  // eslint-disable-next-line global-require
  sharp = require('sharp');
} catch (err) {
  sharp = null; // handled at call time with a clear warning
}

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630; // standard social-card / OG-image aspect ratio

// The app is a strict black/white/gray design system (see
// frontend/src/styles/tokens.css) — fallback cards used to be tinted per
// topic (blue for tech, green for finance, etc.), which broke that system.
// Topic differentiation now comes from the uppercase label text alone, so
// every fallback card renders with the same surface/text/border colors,
// copied directly from tokens.css so the two stay in sync:
//   --color-surface:      #141414
//   --color-text:         #ffffff
//   --color-text-muted:   #8a8a8a
//   --color-border:       #2a2a2a
const CARD_BG = '#141414';
const TEXT_COLOR = '#ffffff';
const MUTED_COLOR = '#8a8a8a';
const BORDER_COLOR = '#2a2a2a';

const OUTPUT_DIR = path.join(__dirname, '..', '..', 'public', 'generated');

function getPublicBaseUrl() {
  const configured = process.env.PUBLIC_BASE_URL;
  if (configured) return configured.replace(/\/+$/, '');
  const port = process.env.PORT || 4000;
  return `http://localhost:${port}`;
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapText(text, maxCharsPerLine, maxLines) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && current) lines.push(current);

  if (words.join(' ').length > lines.join(' ').length && lines.length === maxLines) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = `${last.slice(0, Math.max(0, maxCharsPerLine - 1)).trim()}\u2026`;
  }

  return lines;
}

function buildSvg({ title, topicKey }) {
  // No color lookup anymore — every fallback card uses the same monochrome
  // surface. The topic label (small, muted-gray, uppercase) is the only
  // thing that differs between topics, matching how the rest of the UI
  // differentiates topics through typography rather than color.
  const label = String(topicKey || 'news').toUpperCase();

  const fontSize = 54;
  const lineHeight = Math.round(fontSize * 1.25);
  const padding = 80;
  const maxCharsPerLine = Math.floor((CARD_WIDTH - padding * 2) / (fontSize * 0.55));
  const lines = wrapText(title || '', maxCharsPerLine, 4);

  const topBand = 160; // room for the topic label
  const bottomBand = 90; // room for the wordmark
  const availableHeight = CARD_HEIGHT - topBand - bottomBand;
  const blockHeight = lines.length * lineHeight;
  const startY = topBand + Math.max(0, (availableHeight - blockHeight) / 2) + fontSize;

  const textLines = lines
    .map(
      (line, i) =>
        `<text x="${padding}" y="${startY + i * lineHeight}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="700" fill="${TEXT_COLOR}">${escapeXml(line)}</text>`
    )
    .join('\n');

  return `
<svg width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${CARD_BG}" />
  <rect x="1" y="1" width="${CARD_WIDTH - 2}" height="${CARD_HEIGHT - 2}" fill="none" stroke="${BORDER_COLOR}" stroke-width="2" />
  <text x="${padding}" y="93" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700" fill="${MUTED_COLOR}" letter-spacing="2">${escapeXml(label)}</text>
  <rect x="${padding}" y="112" width="64" height="3" fill="${MUTED_COLOR}" />
  ${textLines}
  <text x="${CARD_WIDTH - padding}" y="${CARD_HEIGHT - 40}" font-family="Arial, Helvetica, sans-serif" font-size="26" fill="${MUTED_COLOR}" text-anchor="end">Scoopr</text>
</svg>`.trim();
}

function filenameFor(item) {
  const hash = crypto.createHash('sha1').update(item.sourceId || item.title || '').digest('hex').slice(0, 20);
  return `${hash}.png`;
}

// Generates (or reuses a cached) fallback graphic for an item and returns
// its public URL, or `null` if generation isn't possible/fails.
async function generateFallbackImage(item, topicKey) {
  if (!sharp) {
    console.warn('[imageHandler] "sharp" is not installed — run `npm install sharp` (see README). Skipping fallback image.');
    return null;
  }

  try {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const filename = filenameFor(item);
    const outputPath = path.join(OUTPUT_DIR, filename);
    const publicUrl = `${getPublicBaseUrl()}/generated/${filename}`;

    if (fs.existsSync(outputPath)) {
      return publicUrl; // already generated on a previous run — reuse it
    }

    const svg = buildSvg({ title: item.title, topicKey });
    await sharp(Buffer.from(svg)).png().toFile(outputPath);

    return publicUrl;
  } catch (err) {
    console.warn(`[imageHandler] Failed to generate fallback image for "${item.sourceId}": ${err.message}`);
    return null;
  }
}

// Takes a normalized item and its topic, and resolves to a final imageUrl:
// the source's own image if it has one, otherwise a generated fallback
// (or null if even the fallback couldn't be made). Never rejects.
async function resolveImage(item, topicKey) {
  if (item.imageUrl && typeof item.imageUrl === 'string' && item.imageUrl.trim()) {
    return item.imageUrl.trim();
  }
  return generateFallbackImage(item, topicKey);
}

module.exports = { resolveImage };
