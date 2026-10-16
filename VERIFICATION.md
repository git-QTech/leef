# 🛡️ Verifying Leef Browser Builds

Leef Browser is built with privacy and transparency at its core. We provide multiple independent ways to prove that the installer and application you download correspond directly and authentically to the open-source code in this repository.

---

## 1. Cryptographic Checksum Verification (SHA-256)

Every release includes a `SHA256SUMS.txt` file and lists individual file hashes directly in the release notes. You can verify that your downloaded installer has not been modified or corrupted.

### Windows (PowerShell)
```powershell
Get-FileHash .\leef-browser-setup-1.2.1.exe -Algorithm SHA256
```
Compare the output `Hash` to the value listed in the release notes or `SHA256SUMS.txt`.

### macOS
```bash
shasum -a 256 leef-browser-setup-1.2.1.dmg
```

### Linux
```bash
# Verify against the SHA256SUMS.txt file
sha256sum -c SHA256SUMS.txt
```

---

## 2. GitHub Artifact Attestations (SLSA Provenance)

Starting with automated releases, Leef Browser uses **GitHub Artifact Attestations** (backed by Sigstore and the SLSA framework).

This cryptographically proves that:
1. The binary was built by GitHub Actions directly from the `git-QTech/leef` repository.
2. It originated from the exact commit SHA and tag associated with the release.
3. The binary was not altered or swapped after being built.

### How to Verify via GitHub CLI:

If you have the [GitHub CLI (`gh`)](https://cli.github.com/) installed:

```bash
gh attestation verify leef-browser-setup-1.2.1.exe --owner git-QTech
```

You will see output confirming the attestation:
```text
Loaded digest sha256:... for leef-browser-setup-1.2.1.exe
✓ Verification succeeded!
Attestation was created by GitHub Actions in git-QTech/leef
```

---

## 3. Direct Source Code Inspection (ASAR Extraction)

Because Leef is an Electron application, the complete application source code (HTML, CSS, JavaScript) is packaged inside the standard `app.asar` archive. You can unpack and view the exact source code running on your machine at any time.

### Step 1: Locate `app.asar`
- **Windows**: `%LocalAppData%\Programs\private-browser\resources\app.asar`
- **macOS**: `/Applications/Leef Browser.app/Contents/Resources/app.asar`
- **Linux**: `/opt/Leef Browser/resources/app.asar`

### Step 2: Extract the archive
```bash
npx @electron/asar extract "path/to/app.asar" ./leef-unpacked
```

### Step 3: Compare with Git Source
You can compare the extracted files against the repository source code for that version:
```bash
git checkout v1.2.1
# Compare files (main.js, renderer.js, etc.)
diff -r ./leef-unpacked/main.js ./main.js
```

---

## For Maintainers: Generating Checksums

When building releases locally:
```powershell
npm run dist
npm run checksums
```
This generates `dist/SHA256SUMS.txt` and formats a copy-paste snippet for the GitHub Release notes.
