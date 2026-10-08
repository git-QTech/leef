/**
 * Leef Browser - I18N Automation & Locale Synchronizer
 * 
 * To add a new language in the future:
 * 1. Create locales/<language-code>.json (e.g., locales/it.json)
 * 2. Run: npm run sync-locales
 * That's it! No HTML edits or page bloating required.
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const localesDir = path.join(projectRoot, 'locales');

// Define language metadata
const LANGUAGE_META = {
  'en': { name: 'American English' },
  'en-gb': { name: 'British English' },
  'en-ca': { name: 'Canadian English' },
  'fr': { name: 'Français (French)' },
  'es': { name: 'Español (Spanish)' },
  'nl': { name: 'Nederlands (Dutch)' },
  'de': { name: 'Deutsch (German)' },
  'it': { name: 'Italiano (Italian)' },
  'pt': { name: 'Português (Portuguese)' },
  'ja': { name: '日本語 (Japanese)' },
  'zh': { name: '中文 (Chinese)' },
  'pl': { name: 'Polski (Polish)' },
  'ru': { name: 'Русский (Russian)' },
  'sv': { name: 'Svenska (Swedish)' }
};

// 1. Load all locale files from locales/
const loadedLocales = {};
const localeFiles = fs.readdirSync(localesDir).filter(f => f.endsWith('.json'));

localeFiles.forEach(file => {
  const code = file.replace('.json', '').toLowerCase();
  try {
    const content = JSON.parse(fs.readFileSync(path.join(localesDir, file), 'utf8'));
    loadedLocales[code] = content;
  } catch (err) {
    console.error(`Error reading ${file}:`, err);
  }
});

// Calculate master keys from en.json
const masterKeys = Object.keys(loadedLocales['en'] || {});

// Generate SUPPORTED_LANGUAGES dynamically
const supportedLanguages = [];
// Priority standard list
const priorityCodes = ['en', 'en-gb', 'en-ca', 'fr', 'es', 'nl', 'de'];
const allFoundCodes = Array.from(new Set([...priorityCodes, ...Object.keys(loadedLocales)]));

allFoundCodes.forEach(code => {
  if (code.includes('-') && !loadedLocales[code] && loadedLocales['en']) {
    // Regional variant
    const meta = LANGUAGE_META[code] || { name: code.toUpperCase() };
    supportedLanguages.push({
      code,
      name: meta.name,
      completion: '100%'
    });
    return;
  }

  if (!loadedLocales[code]) return;

  const dict = loadedLocales[code];
  const totalKeys = masterKeys.length || 1;
  const translatedCount = masterKeys.filter(k => dict[k] !== undefined).length;
  const percent = Math.min(100, Math.round((translatedCount / totalKeys) * 100));

  const meta = LANGUAGE_META[code] || { name: code.toUpperCase() };
  supportedLanguages.push({
    code,
    name: meta.name,
    completion: `${percent}%`
  });
});

// Update translations.js and i18n.js
function updateBundle(targetPath) {
  const fullPath = path.join(projectRoot, targetPath);
  if (!fs.existsSync(fullPath)) return;

  const existingCode = fs.readFileSync(fullPath, 'utf8');

  // Replace SUPPORTED_LANGUAGES
  const suppStart = existingCode.indexOf('export const SUPPORTED_LANGUAGES = [');
  const suppEnd = existingCode.indexOf('export const TRANSLATIONS = {', suppStart);
  
  if (suppStart === -1 || suppEnd === -1) {
    throw new Error('Could not find SUPPORTED_LANGUAGES or TRANSLATIONS in ' + targetPath);
  }

  const transStart = suppEnd;
  const transEnd = existingCode.indexOf('export function decodeHtml', transStart);
  if (transEnd === -1) {
    throw new Error('Could not find decodeHtml boundary in ' + targetPath);
  }

  const before = existingCode.slice(0, suppStart);
  const after = existingCode.slice(transEnd);

  const suppBlock = `export const SUPPORTED_LANGUAGES = ${JSON.stringify(supportedLanguages, null, 2)};\n\n`;
  const transBlock = `export const TRANSLATIONS = ${JSON.stringify(loadedLocales, null, 2)};\n\n`;

  const finalCode = before + suppBlock + transBlock + after;
  fs.writeFileSync(fullPath, finalCode, 'utf8');
  console.log(`Updated ${targetPath}`);
}

updateBundle('translations.js');
updateBundle('i18n.js');

console.log(`\nSuccessfully synchronized ${localeFiles.length} languages across the application!`);
console.log('Supported languages:', supportedLanguages.map(l => `${l.name} (${l.code})`).join(', '));
