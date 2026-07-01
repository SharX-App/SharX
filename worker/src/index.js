const RATE_LIMIT = 30;
const WINDOW_MS = 10 * 60 * 1000;

const ipRequests = new Map();

// Bump this whenever the system prompt in index.html changes meaningfully —
// it invalidates old D1 cache rows without deleting them (they just stop matching).
const CURRENT_PROMPT_VERSION = 'v1-guardrails-15';

// Minimal starter synonym map so brand names / common aliases collapse onto the
// same cache row as their canonical form. Extend over time.
const SYNONYMS = {
  'zoloft': 'sertraline',
  'ginger': 'zingiber officinale',
  'ginger root': 'zingiber officinale',
  'ginseng': 'panax ginseng',
  'asian ginseng': 'panax ginseng',
  'korean ginseng': 'panax ginseng',
  'st johns wort': 'hypericum perforatum',
  'saint johns wort': 'hypericum perforatum',
  'fish oil': 'omega-3 fatty acids',
  'omega 3': 'omega-3 fatty acids',
  'omega-3': 'omega-3 fatty acids',
  'turmeric': 'curcumin'
};

function normalizeItem(value) {
  const cleaned = (value || '')
    .toLowerCase()
    .trim()
    .replace(/[.,']/g, '')
    .replace(/\s+/g, ' ');
  return SYNONYMS[cleaned] || cleaned;
}

function buildPairKey(items, lang) {
  const normalized = items.map(normalizeItem).filter(Boolean).sort();
  return normalized.join('|') + '|' + (lang || 'en');
}

function corsHeaders(extra) {
  return Object.assign({
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  }, extra || {});
}

async function readCache(env, pairKey) {
  const row = await env.DB.prepare(
    'SELECT result_json FROM interactions_cache WHERE pair_key = ? AND prompt_version = ?'
  ).bind(pairKey, CURRENT_PROMPT_VERSION).first();
  return row ? row.result_json : null;
}

async function writeCache(env, pairKey, items, resultJsonText) {
  let severity = '';
  try { severity = (JSON.parse(resultJsonText).severity || '').toLowerCase(); } catch (e) {}

  const now = new Date().toISOString();
  const itemA = items[0] ? items[0].value : null;
  const itemAType = items[0] ? items[0].type : null;
  // Schema only has two item columns; for 3+ substance combos, item_b holds the
  // remaining substances joined with "+" (pair_key itself is what's actually used
  // for lookup, so this only affects the human-readable columns).
  const itemB = items.length > 2
    ? items.slice(1).map(function (i) { return i.value; }).join(' + ')
    : (items[1] ? items[1].value : null);
  const itemBType = items[1] ? items[1].type : null;

  await env.DB.prepare(
    'INSERT INTO interactions_cache ' +
    '(pair_key, item_a, item_b, item_a_type, item_b_type, rating, result_json, prompt_version, created_at, updated_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT(pair_key) DO UPDATE SET ' +
    'item_a = excluded.item_a, item_b = excluded.item_b, item_a_type = excluded.item_a_type, ' +
    'item_b_type = excluded.item_b_type, rating = excluded.rating, result_json = excluded.result_json, ' +
    'prompt_version = excluded.prompt_version, updated_at = excluded.updated_at'
  ).bind(pairKey, itemA, itemB, itemAType, itemBType, severity, resultJsonText, CURRENT_PROMPT_VERSION, now, now).run();
}

function extractResultJson(anthropicResponseText) {
  const parsed = JSON.parse(anthropicResponseText);
  const text = parsed.content.map(function (c) { return c.text || ''; }).join('');
  const clean = text.replace(/```json|```/g, '').trim();
  const j1 = clean.indexOf('{'), j2 = clean.lastIndexOf('}');
  if (j1 === -1 || j2 === -1) return null;
  // Validate it's parseable JSON, but keep the original text formatting for storage.
  JSON.parse(clean.substring(j1, j2 + 1));
  return clean.substring(j1, j2 + 1);
}

function wrapCachedResult(resultJsonText) {
  return JSON.stringify({
    id: 'cache',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: resultJsonText }],
    stop_reason: 'end_turn'
  });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, x-api-key, anthropic-version',
          'Access-Control-Allow-Methods': 'POST, OPTIONS'
        }
      });
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const now = Date.now();
    const entry = ipRequests.get(ip) || { count: 0, start: now };

    if (now - entry.start > WINDOW_MS) {
      entry.count = 0;
      entry.start = now;
    }

    entry.count++;
    ipRequests.set(ip, entry);

    if (entry.count > RATE_LIMIT) {
      return new Response(JSON.stringify({ error: 'Too many requests' }), {
        status: 429,
        headers: corsHeaders()
      });
    }

    const bodyText = await request.text();

    let parsedBody = null;
    try { parsedBody = JSON.parse(bodyText); } catch (e) {}

    const meta = parsedBody && parsedBody.meta;
    const hasConditions = !!(meta && Array.isArray(meta.conditions) && meta.conditions.length > 0);
    const canUseCache = !!(env.DB && meta && Array.isArray(meta.items) && meta.items.length > 0 && !hasConditions);

    let pairKey = null;

    if (canUseCache) {
      pairKey = buildPairKey(meta.items.map(function (i) { return i.value; }), meta.lang);
      try {
        const cached = await readCache(env, pairKey);
        if (cached) {
          return new Response(wrapCachedResult(cached), {
            status: 200,
            headers: corsHeaders()
          });
        }
      } catch (e) {
        // D1 unavailable/misconfigured — fail open to a live API call rather than error out.
      }
    }

    // Cache miss (or bypass): forward to Anthropic. Strip our custom `meta` field first.
    let forwardBody = bodyText;
    if (parsedBody && Object.prototype.hasOwnProperty.call(parsedBody, 'meta')) {
      const rest = Object.assign({}, parsedBody);
      delete rest.meta;
      forwardBody = JSON.stringify(rest);
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: forwardBody
    });

    const data = await response.text();

    if (response.ok && pairKey) {
      ctx.waitUntil((async () => {
        try {
          const resultJsonText = extractResultJson(data);
          if (resultJsonText) await writeCache(env, pairKey, meta.items, resultJsonText);
        } catch (e) {
          // Caching is best-effort — never let a storage failure affect the user-facing response.
        }
      })());
    }

    return new Response(data, {
      status: response.status,
      headers: corsHeaders()
    });
  }
};
