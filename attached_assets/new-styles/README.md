# Adding new (global) styles

Drop new style-reference thumbnails here (16:9, .jpg/.png/.webp), then run:

```bash
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
node scripts/tag-styles.mjs
```

That vision-tags each image, embeds it (768-dim vector), uploads it to the
`styles` Storage bucket, and inserts a row into `public.style_images` — so it
shows up in BOTH the manual "Styles" picker AND the YouTube auto-match flow
(`match_styles()`), which only searches rows that have an embedding.

## Titles (recommended)

If you know which video a thumbnail came from, add it to `manifest.json` in
this folder:

```json
{
  "my-thumbnail.jpg": "How I Made $10,000 in a Week Trading Crypto"
}
```

The title is folded into the embedding — it carries the actual topic signal
directly, so matching to a similarly-themed new video is measurably better
than relying on the vision tagger alone (which can't tell two visually
similar thumbnails, e.g. two "shocked face" shots, apart by topic).

Files not listed in the manifest are still tagged fine, just from the image
alone.

Re-running the script is safe — an image whose Storage path already has an
embedding is skipped, so you can keep dropping in new files over time.
