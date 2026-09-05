// ═══════════════════════════════════════════════════════════════════════════
// Shared embedding helper — Vertex/Gemini first, OpenRouter as fallback.
//
// OpenRouter serves the SAME model (google/gemini-embedding-2, via its own
// Google Vertex/AI Studio backend) through an OpenAI-compatible /embeddings
// endpoint that supports the same 768 output dimension our style_images.embedding
// column uses — so a fallback here stays in the same vector space as every
// embedding already stored, unlike swapping to a different embedding model
// (e.g. an OpenAI one), which would produce vectors that cosine-similarity
// search can't meaningfully compare against the existing ones.
//
// Used by match-style (embeds the query — no fallback here means the whole
// YouTube auto-style-match feature dies with Vertex), index-style and
// admin-styles (embeds the tagged metadata after vision-tagging, which still
// requires Vertex itself — this only guards the embedding call specifically).
// ═══════════════════════════════════════════════════════════════════════════

export async function embedWithFallback(
  vertexAi: any,
  text: string,
  dims: number,
  taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY',
): Promise<number[] | null> {
  const embedModel = Deno.env.get('EMBED_MODEL') || 'gemini-embedding-2';

  if (vertexAi) {
    try {
      const r: any = await Promise.race([
        vertexAi.models.embedContent({
          model: embedModel,
          contents: text,
          config: { outputDimensionality: dims, taskType },
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('vertex_embed_timeout')), 15000)),
      ]);
      const v = r?.embeddings?.[0]?.values;
      if (Array.isArray(v) && v.length) return v;
    } catch (e: any) {
      console.error('vertex_embed_failed', e?.message || String(e));
    }
  }

  const orKey = Deno.env.get('OPENROUTER_API_KEY');
  if (!orKey) return null;
  try {
    const resp = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${orKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-embedding-2',
        input: text,
        dimensions: dims,
      }),
    });
    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error('openrouter_embed_failed', resp.status, JSON.stringify(data));
      return null;
    }
    const v = data?.data?.[0]?.embedding;
    // Guard against a provider silently ignoring `dimensions` and returning a
    // different size — inserting that into the fixed vector(768) column would
    // either fail loudly (fine) or, worse, get coerced into a garbage vector
    // that ruins cosine-similarity search for that row. Reject anything that
    // doesn't match exactly.
    return Array.isArray(v) && v.length === dims ? v : null;
  } catch (e: any) {
    console.error('openrouter_embed_error', e?.message || String(e));
    return null;
  }
}
