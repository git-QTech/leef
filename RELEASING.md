# Leef Browser: Release Checklist 🚀

Follow these steps before every new release to ensure a clean, professional, and privacy-respecting build for your users.

## 1. Version Bump
- [ ] Update `"version": "x.x.x"` in `package.json`.
- [ ] Update the **Changelog** in `index.html` to reflect the new changes.

## 2. Pre-Flight Clean (Developer Machine)
Before running the final build, ensure your local environment isn't leaking data:
- [ ] **Delete the `dist` folder**: `rm -rf dist/`
- [ ] **Check for rogue data**: Ensure no folders named `Local Storage`, `Partitions`, or `Network` exist in the project root. (Our `package.json` now filters these, but it's good to be safe).

## 3. Generate the Installer & Checksums
- [ ] Run the build command:
  ```powershell
  npm run dist
  ```
- [ ] Verify the installer size is around **150-160 MB**. If it jumps to 300MB+, you are accidentally bundling your local cache!
- [ ] Generate release checksums:
  ```powershell
  npm run checksums
  ```
  *(This generates `dist/SHA256SUMS.txt` and prints a copy-paste snippet for your release notes).*

## 4. The "Fresh Install" Test
To verify the installer is clean on your own machine:
1. **Delete your AppData**: Go to `%AppData%` and delete the `private-browser` folder.
2. **Run the New Installer**: Ensure it starts with the **"Welcome to Leef"** onboarding screen.
3. **Check for "Ghost Data"**: Verify that History, Cookies, and Bookmarks are all empty.

## 5. GitHub Upload (Manual Release)
- [ ] Create a new **Release** on GitHub with the version tag (e.g., `v1.2.1`).
- [ ] **Windows Upload**: Upload `leef-browser-setup-x.x.x.exe` AND `latest.yml`.
- [ ] **macOS Upload**: Upload the `.dmg` / `.zip` file AND `latest-mac.yml`. *(Note: `latest.yml` is for Windows and `latest-mac.yml` is for macOS — they sit side-by-side without conflicting!)*
- [ ] **Checksums**: Upload `dist/SHA256SUMS.txt` and paste the snippet from `npm run checksums` into the release notes.

## 6. Building on macOS
To build the macOS release locally on a Mac:
```bash
npm run dist:mac
npm run checksums
```
- Produces a Universal binary (Intel + Apple Silicon) in `dist/`.
- Configured with `identity: null` so it builds cleanly without requiring paid Apple Developer certificates in your local Keychain.
- Output files (`.dmg`, `.zip`, `latest-mac.yml`) do not collide with or overwrite Windows build files.

## 7. Automated Releases with Provenance Attestations (Alternative)
You can also let GitHub Actions build, sign, and attest releases automatically:
- Push a tag like `v1.2.1` to GitHub.
- GitHub Actions automatically builds Windows, macOS, and Linux packages in parallel, generates SLSA cryptographic attestations, and attaches all assets and checksums to the release. See [VERIFICATION.md](file:///c:/Users/quinn/leef/leef/VERIFICATION.md) for details.

---

### Pro-Tip: Dev Mode Isolation
We have now configured `main.js` so that running `npm start` (Dev Mode) uses a separate folder: `%AppData%\Leef-Dev`. Your personal browsing in the "real" Leef Browser will no longer mix with your testing sessions!
