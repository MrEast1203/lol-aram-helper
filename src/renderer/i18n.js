// App language for the renderer windows; see src/main/i18n.js. Elements with a
// data-i18n attribute have their own text translated on load.
const { lang, strings } = await window.api.i18n();

export { lang };
// Dates follow the app language; the Chinese UI keeps the system's own format.
export const dateLocale = lang === 'en' ? 'en-US' : undefined;

export function t(s, args) {
  const out = strings[s] || s;
  return args ? out.replace(/\{(\w+)\}/g, (m, k) => (k in args ? args[k] : m)) : out;
}

document.documentElement.lang = lang === 'en' ? 'en' : 'zh-Hant';
for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.textContent.trim());
for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.title);
