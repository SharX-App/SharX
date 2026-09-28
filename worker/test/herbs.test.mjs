// Pokretanje: node worker/test/herbs.test.mjs  (zove pravi RxNorm)
// Ocekivanja su iz sheet-a "Test scenariji" u SharX-Mapiranje-Interakcija-Tom1.xlsx.
import { findBookMatches, canAnswerFromBook, buildBookResult } from '../src/herbs.js';
import { HERB_DB } from '../src/herb_db.js';

const EXPECTED = {
  warfarin: '23 31 40 43 54 57 61 76 85 96 102 111 114 116 126 127 132 134 150 154 162 169a',
  apixaban: '31 40 43 61 76 77 102 116 126 127 134 150 154 169a',
  dabigatran: '31 40 43 61 76 102 116 126 127 134 150 154 169a',
  enoxaparin: '31 40 76 102 116 126 127 134 150 154 169a',
  clopidogrel: '31 40 76 102 116 127 134 150 154 169a',
  simvastatin: '47 53 77 110 169b',
  rosuvastatin: '53 110 169b',
  clozapine: '25 29',
  quetiapine: '',
  sertraline: '22 46 51 66 97 104 130 133',
  venlafaxine: '22 46 51 66 97 104 130 133',
  lamotrigine: '168',
  levothyroxine: '1 99',
  ibuprofen: '147 159',
  succinylcholine: '19 73 121 148 161',
  rocuronium: '73',
  phenytoin: '124a 132 168 169b',
  // SR naziv mora da ide preko sr_to_inn recnika
  varfarin: '23 31 40 43 54 57 61 76 85 96 102 111 114 116 126 127 132 134 150 154 162 169a',
};

const allPlants = HERB_DB.plants.filter(function (p) { return p.volume === 1; }).map(function (p) { return { type: 'Herb', value: p.text.sr.name }; });
let failed = 0;
for (const [drug, exp] of Object.entries(EXPECTED)) {
  const book = await findBookMatches([{ type: 'Drug (Rx)', value: drug }].concat(allPlants));
  const got = [...new Set(book.hits.map(function (h) { return h.interaction.id; }))];
  const want = exp.split(' ').filter(Boolean);
  const missing = want.filter(function (id) { return got.indexOf(id) === -1; });
  const extra = got.filter(function (id) { return want.indexOf(id) === -1; });
  const ok = !missing.length && !extra.length;
  if (!ok) failed++;
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + drug.padEnd(16) + ' ' + got.length + '/' + want.length +
    (missing.length ? '  fali: ' + missing.join(',') : '') + (extra.length ? '  visak: ' + extra.join(',') : ''));
}

// Prepoznavanje biljke po aliasima + da slicna imena NE hvataju pogresnu biljku
const aliasCases = [['Ashwagandha', 'Ašvaganda'], ['asvaganda', 'Ašvaganda'], ['Hypericum perforatum', 'Kantarion'],
  ["St. John's wort", 'Kantarion'], ['Zob', 'Ovas / Zob'], ['Kantarion (Hypericum perforatum)', 'Kantarion'],
  ['kamilica', null], ['lipa', 'Lipa'], ['lipa sitnolisna', 'Lipa sitnolisna'], ['ginseng', 'Ženšen']];
for (const [input, want] of aliasCases) {
  const book = await findBookMatches([{ type: 'Herb', value: input }]);
  const got = book ? book.plants[0].sr : null;
  if (got !== want) failed++;
  console.log((got === want ? 'OK  ' : 'FAIL') + ' alias ' + JSON.stringify(input) + ' -> ' + got);
}
// Ozbiljnost u odgovoru iz knjige: MAJOR odluke farmaceuta (severity_major.json), inace ⚠=MODERATE, ℹ=MINOR
const severityCases = [['Kukurek', 'digoxin', 'MAJOR'], ['Kantarion', 'Zoloft', 'MAJOR'], ['Ašvaganda', 'levotiroksin', 'MODERATE'],
  ['Mak', 'diazepam', 'MAJOR'], ['Bob', 'phenelzine', 'MAJOR'], ['Hmelj', 'diazepam', 'MODERATE']];
for (const [herb, drug, want] of severityCases) {
  const book = await findBookMatches([{ type: 'Herb', value: herb }, { type: 'Drug (Rx)', value: drug }]);
  const fromBook = canAnswerFromBook(book, [1, 2], 'sr', false);
  const got = fromBook ? buildBookResult(book, 'sr').severity : 'Claude (' + (book.hits.some(function (h) { return h.interaction.major; }) ? 'pod MAJOR' : 'pod MODERATE') + ')';
  const ok = got === want || (!fromBook && want === 'MAJOR' && got === 'Claude (pod MAJOR)');
  if (!ok) failed++;
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + (herb + ' + ' + drug).padEnd(28) + ' -> ' + got);
}
// Tom 2 — kljucni slucajevi: [biljka, lek, jezik, ocekivano]
// ocekivano: 'MAJOR'/'MODERATE'/'MINOR' = odgovor iz knjige; 'Claude' = ide Claude-u sa knjigom kao izvorom; 'nema' = bez pogodaka
const tom2Cases = [
  ['Grejpfrut', 'simvastatin', 'sr', 'MAJOR'],
  ['Grejpfrut', 'rosuvastatin', 'sr', 'nema'],
  ['Đurđevak', 'digoxin', 'sr', 'MAJOR'],
  ['Ginko', 'apixaban', 'sr', 'Claude'],
  ['Glog', 'digoxin', 'sr', 'Claude'],
  ['Suncokret', 'cyclosporine', 'sr', 'nema'],
  ['Garlic', 'warfarin', 'en', 'MODERATE'],
  ['Vinova loza', 'warfarin', 'en', 'MODERATE'],
  ['Vunasti naprstak', 'succinylcholine', 'sr', 'MODERATE'],
  ['Vunasti naprstak', 'rocuronium', 'sr', 'nema'],
  ['Gorka pomorandža', 'phenelzine', 'sr', 'MAJOR'],
];
for (const [herb, drug, lang, want] of tom2Cases) {
  const book = await findBookMatches([{ type: 'Herb', value: herb }, { type: 'Drug (Rx)', value: drug }]);
  let got;
  if (!book || !book.hits.length) got = 'nema';
  else if (canAnswerFromBook(book, [1, 2], lang, false)) got = buildBookResult(book, lang).severity;
  else got = 'Claude';
  if (got !== want) failed++;
  console.log((got === want ? 'OK  ' : 'FAIL') + ' T2 ' + (herb + ' + ' + drug + ' [' + lang + ']').padEnd(40) + ' -> ' + got +
    (book && book.hits.length ? '  (' + book.hits.map(function (h) { return h.interaction.id; }).join(',') + ')' : ''));
}
// Tom 3 + ispravljeni nazivi iz knjige (28.09)
const tom3Cases = [
  ['Tatula', 'oxybutynin', 'sr', 'MAJOR'],
  ['Morska sleđika', 'phenelzine', 'sr', 'MAJOR'],
  ['Sladić', 'digoxin', 'sr', 'MODERATE'],
  ['Sage', 'warfarin', 'en', 'MODERATE'],
  ['Crni luk', 'apixaban', 'sr', 'Claude'],
  ['Potočarka', 'warfarin', 'sr', 'Claude'],
  ['Kamfor', 'phenytoin', 'en', 'MODERATE'],
];
for (const [herb, drug, lang, want] of tom3Cases) {
  const book = await findBookMatches([{ type: 'Herb', value: herb }, { type: 'Drug (Rx)', value: drug }]);
  let got;
  if (!book || !book.hits.length) got = 'nema';
  else if (canAnswerFromBook(book, [1, 2], lang, false)) got = buildBookResult(book, lang).severity;
  else got = 'Claude';
  if (got !== want) failed++;
  console.log((got === want ? 'OK  ' : 'FAIL') + ' T3 ' + (herb + ' + ' + drug + ' [' + lang + ']').padEnd(40) + ' -> ' + got +
    (book && book.hits.length ? '  (' + book.hits.map(function (h) { return h.interaction.id; }).join(',') + ')' : ''));
}
const nameCases = [['podbel', ['3:Podbel:Tussilago farfara']], ['repuh', ['1:Podbel:Petasites hybridus']],
  ['divizma', ['3:Divizma:Verbascum phlomoides']], ['dubačac', ['2:Divizma:Teucrium chamaedrys']],
  ['CYP2E1 interakcija', []], ['potočarka', ['3:CYP2E1 interakcija:Nasturtium officinale', '3:PEITC / vitamin K:Nasturtium officinale']]];
for (const [input, want] of nameCases) {
  const book = await findBookMatches([{ type: 'Herb', value: input }]);
  const got = book ? book.plants.map(function (p) { return p.key; }) : [];
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log((ok ? 'OK  ' : 'FAIL') + ' ime ' + JSON.stringify(input).padEnd(22) + ' -> ' + (got.join(' | ') || '(nema)'));
}
console.log(failed ? '\n' + failed + ' FAIL' : '\nSVE PROSLO');
process.exit(failed ? 1 : 0);
