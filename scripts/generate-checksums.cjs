/**
 * Leef Browser - Release Checksum Generator
 * 
 * Computes cryptographic SHA-256 hashes for build artifacts in dist/
 * and generates a standard SHA256SUMS.txt file for release verification.
 * 
 * Usage:
 *   npm run checksums
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');
const pkgPath = path.join(projectRoot, 'package.json');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const currentVersion = pkg.version;

if (!fs.existsSync(distDir)) {
  console.error('❌ dist/ directory not found. Please build the application first (e.g. npm run dist).');
  process.exit(1);
}

// Target extensions for distribution packages
const VALID_EXTENSIONS = new Set(['.exe', '.dmg', '.zip', '.appimage', '.deb', '.rpm', '.tar.gz']);

function calculateFileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', err => reject(err));
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function main() {
  const files = fs.readdirSync(distDir);
  
  // Find all candidate installer/archive files
  const candidateFiles = files.filter(file => {
    const fullPath = path.join(distDir, file);
    if (!fs.statSync(fullPath).isFile()) return false;
    if (file.endsWith('.blockmap') || file.endsWith('.yml') || file.endsWith('.txt')) return false;

    const lower = file.toLowerCase();
    return Array.from(VALID_EXTENSIONS).some(ext => lower.endsWith(ext));
  });

  if (candidateFiles.length === 0) {
    console.warn('⚠️ No installer artifacts (.exe, .dmg, .zip, etc.) found in dist/.');
    return;
  }

  // Prioritize files matching current version if available, otherwise process all candidates
  const versionMatched = candidateFiles.filter(file => file.includes(currentVersion));
  const targetFiles = (versionMatched.length > 0 && !process.argv.includes('--all'))
    ? versionMatched
    : candidateFiles;

  console.log(`\n🔒 Generating SHA-256 Checksums for Leef Browser v${currentVersion}...\n`);

  const results = [];
  const checksumLines = [];

  for (const filename of targetFiles) {
    const fullPath = path.join(distDir, filename);
    const stats = fs.statSync(fullPath);
    const hash = await calculateFileSha256(fullPath);

    results.push({
      file: filename,
      size: formatBytes(stats.size),
      sha256: hash
    });

    checksumLines.push(`${hash}  ${filename}`);
  }

  // Write SHA256SUMS.txt
  const checksumsFile = path.join(distDir, 'SHA256SUMS.txt');
  fs.writeFileSync(checksumsFile, checksumLines.join('\n') + '\n', 'utf8');

  // Print results table to console
  console.table(results.map(r => ({
    File: r.file,
    Size: r.size,
    'SHA-256': r.sha256
  })));

  console.log(`✅ Saved checksums file: dist/SHA256SUMS.txt\n`);

  // Print markdown snippet for release notes
  console.log('📋 Copy-paste snippet for your GitHub Release notes:');
  console.log('──────────────────────────────────────────────────────');
  console.log('### 🔐 Cryptographic Checksums (SHA-256)');
  console.log('Verify your download integrity by checking the SHA-256 checksum:');
  console.log('```');
  checksumLines.forEach(line => console.log(line));
  console.log('```');
  console.log('Verify on Windows: `Get-FileHash <filename> -Algorithm SHA256`');
  console.log('Verify on macOS/Linux: `shasum -a 256 <filename>` or `sha256sum -c SHA256SUMS.txt`');
  console.log('──────────────────────────────────────────────────────\n');
}

main().catch(err => {
  console.error('Error generating checksums:', err);
  process.exit(1);
});
