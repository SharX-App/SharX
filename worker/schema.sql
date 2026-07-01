CREATE TABLE interactions_cache (
  id                INTEGER PRIMARY KEY,
  pair_key          TEXT UNIQUE,          -- normalizovano, npr. "sertraline|zingiber officinale|en"
  item_a            TEXT, item_b          TEXT,
  item_a_type       TEXT, item_b_type     TEXT,   -- drug | herb | supplement | food
  rating            TEXT,                  -- minor | moderate | major | unknown | info
  result_json       TEXT,                  -- pun payload kompatibilan sa showResult()
  evidence_level    TEXT,                  -- rezervisano za Fazu 2a, NULL za sada
  sources_json       TEXT,                 -- rezervisano za Fazu 2a, NULL za sada
  prompt_version    TEXT,                  -- za invalidaciju kad se prompt promijeni
  reviewed_by_pharmacist INTEGER DEFAULT 0,
  reviewer          TEXT, reviewed_at      TEXT,
  created_at        TEXT, updated_at       TEXT
);
