// Shares a generated thumbnail as an actual image FILE (not just a link) via
// the Web Share API — so on mobile it drops straight into WhatsApp/Instagram/
// etc. as an attached image, not a bare URL the recipient has to tap through.
// Falls back to copying the link when file-sharing isn't supported (most
// desktop browsers) or unavailable (fetch/share failure).
export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

export async function shareImage(url: string, filename = 'podcastflux-thumbnail.png'): Promise<ShareResult> {
  const nav = navigator as Navigator & { canShare?: (data?: ShareData & { files?: File[] }) => boolean };

  if (nav.share && nav.canShare) {
    try {
      const resp = await fetch(url);
      if (resp.ok) {
        const blob = await resp.blob();
        const file = new File([blob], filename, { type: blob.type || 'image/png' });
        if (nav.canShare({ files: [file] })) {
          // Most share targets (WhatsApp, Instagram, etc.) drop the separate
          // `url` field entirely once `files` is present — text is the only
          // part reliably shown alongside the image, so the link has to live
          // there rather than in `url` alone. Setting both costs nothing for
          // the targets that do honour `url`.
          await nav.share({
            files: [file],
            title: 'PodcastFlux Thumbnail',
            text: 'Made with PodcastFlux — free AI thumbnail maker: https://podcastflux.com',
            url: 'https://podcastflux.com',
          });
          return 'shared';
        }
      }
    } catch (e: any) {
      // The user closing the native share sheet throws AbortError — that's a
      // deliberate cancel, not a failure, so it shouldn't fall through to
      // silently copying a link they never asked for.
      if (e?.name === 'AbortError') return 'cancelled';
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}
