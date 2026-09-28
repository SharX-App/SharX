import { HERB_DB } from './herb_db.js';

// Entries that describe a whole plant rather than a specific drug pairing — per the
// mapping handoff they belong on the plant card, never as a herb+drug match.
const NON_PAIR_SCOPES = ['Opsta napomena', 'Svi oralni lekovi', 'Ne-lek', 'Biljka-biljka'];

function norm(value) {
  return (value || '')
    .toLowerCase()
    .replace(/đ/g, 'dj')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[.,'’]/g, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// One alias can name several monographs (e.g. "Glog" = Crataegus monogyna and C. oxyacantha).
const PLANT_BY_ALIAS = new Map();
HERB_DB.plants.forEach(function (p) {
  p.aliases.forEach(function (a) {
    const k = norm(a);
    const list = PLANT_BY_ALIAS.get(k) || [];
    if (list.indexOf(p) === -1) list.push(p);
    PLANT_BY_ALIAS.set(k, list);
  });
});

const SR_TO_INN = new Map();
Object.keys(HERB_DB.sr_to_inn).forEach(function (k) { SR_TO_INN.set(norm(k), HERB_DB.sr_to_inn[k]); });

// Exact alias match only — fuzzy matching a plant name could attach the wrong
// monograph (e.g. "kamilica" must not match "Rimska kamilica").
function findPlants(value) {
  const full = norm(value);
  if (PLANT_BY_ALIAS.has(full)) return PLANT_BY_ALIAS.get(full);
  const outer = norm(value.replace(/\([^)]*\)/g, ''));
  if (PLANT_BY_ALIAS.has(outer)) return PLANT_BY_ALIAS.get(outer);
  const inner = (value.match(/\(([^)]*)\)/) || [])[1];
  return inner ? (PLANT_BY_ALIAS.get(norm(inner)) || []) : [];
}

async function rx(path) {
  try {
    const res = await fetch('https://rxnav.nlm.nih.gov/REST' + path, { cf: { cacheTtl: 604800, cacheEverything: true } });
    return res.ok ? await res.json() : {};
  } catch (e) {
    return {};
  }
}

async function propAtc(rxcui) {
  const data = await rx('/rxcui/' + rxcui + '/property.json?propName=ATC');
  const concepts = (data.propConceptGroup && data.propConceptGroup.propConcept) || [];
  return concepts.map(function (c) { return c.propValue; });
}

async function relatedConcepts(rxcui, tty) {
  const data = await rx('/rxcui/' + rxcui + '/related.json?tty=' + tty);
  const groups = (data.relatedGroup && data.relatedGroup.conceptGroup) || [];
  const out = [];
  groups.forEach(function (g) { (g.conceptProperties || []).forEach(function (c) { out.push(c); }); });
  return out;
}

// ATC order per handoff: RxNorm ATC property on the ingredient, then on its salt (PIN)
// forms, and only then RxClass — RxClass alone assigns combination-product classes
// (simvastatin -> A10BH) and produces false warnings.
async function atcFor(rxcui) {
  let atc = await propAtc(rxcui);
  if (atc.length) return atc;
  const salts = await relatedConcepts(rxcui, 'PIN');
  for (const s of salts) {
    atc = await propAtc(s.rxcui);
    if (atc.length) return atc;
  }
  const data = await rx('/rxclass/class/byRxcui.json?rxcui=' + rxcui + '&relaSource=ATC');
  const infos = (data.rxclassDrugInfoList && data.rxclassDrugInfoList.rxclassDrugInfo) || [];
  return infos.map(function (i) { return i.rxclassMinConceptItem.classId; });
}

// Returns one entry per active ingredient ({ inn, atc }), or [] when RxNorm doesn't know the name.
async function resolveDrug(value) {
  const name = value.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const query = SR_TO_INN.get(norm(name)) || name;
  const ids = await rx('/rxcui.json?name=' + encodeURIComponent(query) + '&search=2');
  const rxcui = ids.idGroup && ids.idGroup.rxnormId && ids.idGroup.rxnormId[0];
  if (!rxcui) return [];

  const props = await rx('/rxcui/' + rxcui + '/properties.json');
  const p = props.properties || {};
  const ingredients = p.tty === 'IN' ? [{ rxcui: rxcui, name: p.name }] : await relatedConcepts(rxcui, 'IN');

  return Promise.all(ingredients.map(async function (ing) {
    return { inn: (ing.name || '').toLowerCase(), atc: await atcFor(ing.rxcui) };
  }));
}

function interactionMatches(it, drug) {
  if (it.explicit.indexOf(drug.inn) !== -1) return true;
  return it.cats.some(function (k) {
    const cat = HERB_DB.categories[k];
    if (!cat) return false;
    if (cat.inn.indexOf(drug.inn) !== -1) return true;
    return drug.atc.some(function (a) { return cat.atc.some(function (c) { return a.indexOf(c) === 0; }); });
  });
}

// Finds book entries for every (plant, drug) pair in the query.
// Returns null when no item is a plant from the monographs (the common case — no RxNorm calls made).
export async function findBookMatches(items) {
  const plantItems = [];
  const drugItems = [];
  items.forEach(function (item) {
    const plants = findPlants(item.value || '');
    if (plants.length) plants.forEach(function (plant) { plantItems.push({ item: item, plant: plant }); });
    else drugItems.push(item);
  });
  if (plantItems.length === 0) return null;

  const resolved = await Promise.all(drugItems.map(function (d) { return resolveDrug(d.value || ''); }));

  const hits = [];
  plantItems.forEach(function (pi) {
    HERB_DB.interactions.forEach(function (it) {
      if (it.plant !== pi.plant.key || NON_PAIR_SCOPES.indexOf(it.scope) !== -1) return;
      drugItems.forEach(function (d, i) {
        if (resolved[i].some(function (ing) { return interactionMatches(it, ing); })) {
          hits.push({ plant: pi.plant, drugValue: d.value, interaction: it });
        }
      });
    });
  });

  return { plants: plantItems.map(function (pi) { return pi.plant; }), hits: hits };
}

const LABELS = {
  sr: {
    clinical: 'Procena rizika biljke u monografiji: ',
    recommendation: function (source, plant) { return 'Pre kombinovanja posavetujte se sa farmaceutom ili lekarom. Izvor: ' + source + ', monografija „' + plant + '“, pregledao farmaceut.'; }
  },
  en: {
    clinical: 'Monograph risk rating for this plant: ',
    recommendation: function (source, plant) { return 'Consult a pharmacist or physician before combining. Source: ' + source + ', monograph "' + plant + '", pharmacist-reviewed.'; }
  }
};

// The book alone answers only the simplest case: one plant + one drug, a UI language the book exists in, no patient
// conditions, and every matched entry unchanged by the 16.09 pharmacist review (for changed
// entries the original book text no longer holds, so Claude must reconcile it with the decision).
export function canAnswerFromBook(book, items, lang, hasConditions) {
  return !!book && HERB_DB.langs.indexOf(lang) !== -1 && !hasConditions && items.length === 2 &&
    book.plants.length === 1 && book.hits.length > 0 &&
    book.hits.every(function (h) { return !h.interaction.changed; });
}

function splitContraindications(text) {
  const items = [];
  (text || '')
    .split(/(?<=[.\]])\s+(?=[A-ZŠĐČĆŽ])/)
    .map(function (s) { return s.trim(); })
    .filter(Boolean)
    .forEach(function (s) {
      // A short sentence without its own "Topic — detail" belongs to the previous item
      // (e.g. "Trudnoća — ... . Apsolutna kontraindikacija.").
      if (items.length && s.indexOf(' — ') === -1 && s.length < 40) items[items.length - 1] += ' ' + s;
      else items.push(s);
    });
  return items
    .slice(0, 6)
    .map(function (s) {
      const dash = s.indexOf(' — ');
      const title = dash > 0 && dash <= 60 ? s.slice(0, dash) : (s.length > 60 ? s.slice(0, 57) + '…' : s.replace(/\.$/, ''));
      return { substance: '', title: title, description: s, level: /apsolutn|absolute/i.test(s) ? 'major' : 'moderate', personal: false };
    });
}

export function buildBookResult(book, lang) {
  const plant = book.plants[0].text[lang];
  const source = book.plants[0].source[lang];
  const labels = LABELS[lang];
  const hasMajor = book.hits.some(function (h) { return h.interaction.major; });
  const hasWarning = book.hits.some(function (h) { return h.interaction.severity === 'warning'; });
  const enzymes = [];
  book.hits.forEach(function (h) {
    if (/CYP|P-gp/i.test(h.interaction.enzyme) && enzymes.indexOf(h.interaction.enzyme) === -1) enzymes.push(h.interaction.enzyme);
  });

  return {
    severity: hasMajor ? 'MAJOR' : (hasWarning ? 'MODERATE' : 'MINOR'),
    frequency: null,
    cyp: enzymes.length ? enzymes.join(', ') : null,
    unknown_substance: false,
    unknown_name: null,
    // Some monographs explain the shared mechanism once, before the short per-drug entries.
    mechanism: [plant.interactions_intro].concat(book.hits.map(function (h) {
      const t = h.interaction.text[lang];
      return (h.interaction.severity === 'warning' ? '⚠ ' : 'ℹ ') + t.drug_text + ' — ' + t.mechanism;
    })).filter(Boolean).join('\n\n'),
    clinical: labels.clinical + plant.risk_level + ' — ' + plant.risk_summary + '.',
    recommendation: labels.recommendation(source, plant.name),
    contraindications: splitContraindications(plant.contraindications),
    source: 'book'
  };
}

// Languages without a translated book (de/es/fr/it) get the English text; Claude answers in the UI language.
export function buildSourceBlock(book, lang) {
  const src = HERB_DB.langs.indexOf(lang) !== -1 ? lang : 'en';
  const lines = book.hits.map(function (h) {
    const it = h.interaction;
    const t = it.text[src];
    let line = '- Plant: ' + h.plant.text[src].name + (h.plant.latin ? ' (' + h.plant.latin + ')' : '') +
      ' | Drug in query: ' + h.drugValue + ' | Book entry: ' + t.drug_text +
      ' | Level: ' + (it.major ? 'MAJOR (pharmacist-assigned)' : (it.severity === 'warning' ? 'WARNING' : 'INFO')) +
      '\n  Book text: ' + t.mechanism;
    if (it.changed) line += '\n  PHARMACIST REVIEW DECISION (in Serbian; overrides the book text where they differ): ' + it.note;
    return line;
  });
  book.plants.forEach(function (p) {
    const intro = p.text[src].interactions_intro;
    if (intro) lines.unshift('- Book introduction to all ' + p.text[src].name + ' interactions: ' + intro);
  });
  const sources = [];
  book.plants.forEach(function (p) { if (sources.indexOf(p.source[src]) === -1) sources.push(p.source[src]); });
  return 'VERIFIED MONOGRAPH SOURCE — pharmacist-reviewed (' + sources.join('; ') + '). ' +
    'The entries below apply to this query. Treat them as authoritative: your mechanism and recommendation must be ' +
    'consistent with them. Severity must not be lower than MAJOR when any entry is marked MAJOR, ' +
    'and not lower than MODERATE when any entry is marked WARNING. ' +
    'Where a PHARMACIST REVIEW DECISION is given, it overrides the original book text. ' +
    'Write your answer in the language requested in the user message, whatever the language of the source text.\n\n' +
    lines.join('\n\n');
}
