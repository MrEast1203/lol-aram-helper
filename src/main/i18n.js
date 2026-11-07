// App language. The UI is written in Traditional Chinese; when the app language is
// English, t() looks each string up in locales/en.json and falls back to the Chinese.
// Placeholders like {n} are filled from `args` in either language.
const EN = require('../locales/en.json');

const LANGS = ['zh-TW', 'en'];
let lang = 'zh-TW';

// `setting` is 'zh-TW', 'en' or 'auto' (follow the system: Chinese if it is any Chinese).
function resolveLang(setting, systemLocale) {
  if (LANGS.includes(setting)) return setting;
  return /^zh/i.test(systemLocale || '') ? 'zh-TW' : 'en';
}

function setLang(l) {
  lang = LANGS.includes(l) ? l : 'zh-TW';
}

function fill(s, args) {
  return args ? s.replace(/\{(\w+)\}/g, (m, k) => (k in args ? args[k] : m)) : s;
}

function t(s, args) {
  return fill((lang === 'en' && EN[s]) || s, args);
}

module.exports = { t, fill, setLang, resolveLang, getLang: () => lang, strings: () => (lang === 'en' ? EN : {}) };
