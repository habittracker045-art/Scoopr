// Phase 4, Prompt 3: native share for a Feed card.
//
// Per the spec, this must NEVER auto-post anywhere — it only ever hands
// the card's image + caption + link off to the device's own OS share
// sheet (or, as a fallback, the clipboard). Scoopr has no direct
// integration with WhatsApp/Instagram/X/Telegram/etc. at all; the user
// always picks the destination themselves in the native sheet that
// `navigator.share()` opens. There is no code path anywhere in this file
// that sends a request to any of those services.
//
// Three-step fallback chain, tried in order:
//   1. navigator.share() with the card's image attached as a File — the
//      richest option (Web Share API "Level 2", file sharing), so apps
//      like Instagram/WhatsApp get the actual image, not just a link.
//   2. navigator.share() with just title/text/url — used when the API
//      exists but file sharing doesn't (some browsers implement text-only
//      sharing), or when the image couldn't be fetched into a File
//      (e.g. a CORS-restricted image host).
//   3. Clipboard copy of "caption + link" — used when the Web Share API
//      doesn't exist at all (most desktop browsers as of 2026; see the
//      README's "Share fallback behavior" section for browser-by-browser
//      notes and how to test this locally).
//
// Throws only when the user themselves cancels the native share sheet
// (DOMException named 'AbortError') — callers should treat that as a
// silent no-op, not a failure to surface.

async function imageUrlToFile(imageUrl, titleForFilename) {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Image fetch failed (${res.status}).`);
  const blob = await res.blob();

  const ext = (blob.type.split('/')[1] || 'jpg').split('+')[0];
  const safeName = (titleForFilename || 'scoopr-card')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40) || 'scoopr-card';

  return new File([blob], `${safeName}.${ext}`, { type: blob.type || 'image/jpeg' });
}

async function copyToClipboard(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    await navigator.clipboard.writeText(text);
    return;
  }

  // Last-resort fallback for browsers/contexts where the async Clipboard
  // API is unavailable or blocked (e.g. plain-http, non-localhost) — a
  // hidden textarea + the older execCommand('copy').
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    const ok = document.execCommand('copy');
    if (!ok) throw new Error('Copy command was blocked by the browser.');
  } finally {
    document.body.removeChild(textarea);
  }
}

/**
 * @param {{ title: string, caption?: string, imageUrl?: string, sourceUrl?: string }} card
 * @returns {Promise<{ method: 'share-with-image'|'share-text'|'clipboard', message: string }>}
 */
export async function shareCard(card) {
  const shareText = card.caption || card.title;
  const shareUrl = card.sourceUrl || undefined;

  const hasWebShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  if (hasWebShare) {
    // 1. Try image + text + link together.
    if (card.imageUrl && typeof navigator.canShare === 'function') {
      try {
        const file = await imageUrlToFile(card.imageUrl, card.title);
        if (file && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: card.title, text: shareText, url: shareUrl });
          return { method: 'share-with-image', message: 'Shared.' };
        }
      } catch (err) {
        if (err?.name === 'AbortError') throw err; // user cancelled — don't fall through
        // Image fetch/attach didn't work (CORS, network, unsupported
        // file type) — fall through to a text-only native share below
        // rather than failing the whole share attempt.
      }
    }

    // 2. Text + link only.
    try {
      await navigator.share({ title: card.title, text: shareText, url: shareUrl });
      return { method: 'share-text', message: 'Shared.' };
    } catch (err) {
      if (err?.name === 'AbortError') throw err; // user cancelled
      // Some other native-share failure — fall through to clipboard.
    }
  }

  // 3. Clipboard fallback.
  const clipboardText = shareUrl ? `${shareText}\n${shareUrl}` : shareText;
  await copyToClipboard(clipboardText);
  return { method: 'clipboard', message: 'Copied caption & link to your clipboard.' };
}
