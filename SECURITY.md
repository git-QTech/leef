# Security Policy

## Supported Versions

The following versions of Leef Browser currently receive security updates:

| Version | Supported |
| ------- | ------------------ |
| 1.x.x | ✅ Fully Supported |
| 0.x.x | ❌ Support ended June 13th |


---

## Reporting a Vulnerability

We take security seriously. If you discover a vulnerability in Leef Browser, **please do not open a public GitHub issue**.

Instead, report it privately so we can address it before public disclosure:
- **Email:** contact.qtech@proton.me
- **GitHub:** Use [GitHub's private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability) on this repository

### What to include

Please provide as much detail as possible:

1. A description of the vulnerability and its potential impact
2. Steps to reproduce the issue
3. The Leef Browser version affected
4. Any proof-of-concept code or screenshots (if applicable)

---

## Response Timeline

| Stage | Timeframe |
|---|---|
| Initial acknowledgement | Within 48 hours |
| Severity assessment | Within 5 business days |
| Patch release (critical) | Within 14 days |
| Patch release (high/medium) | Within 30 days |
| Public disclosure | After patch is released |

---

## Scope

### In scope
- Remote code execution via the browser
- Sandbox escape from Electron's renderer process
- Authentication/session vulnerabilities
- Data exfiltration via the browser's network layer

### Out of scope
- Issues in websites visited *through* Leef (not the browser itself)
- Missing security headers on third-party sites
- Denial of service requiring physical access

---

## Security Architecture Notes

Leef Browser is built on **Electron** and uses the following security configuration:

- `webSecurity: true` — enforces same-origin policy in webviews
- `contextIsolation: true` / `nodeIntegration: false` — secure preload-based IPC model is used to isolate the renderer from Node.js capabilities
- `sandbox: true` — WebViews explicitly run in an isolated OS-level sandbox
- Content Security Policy (CSP) is active to prevent unauthorized inline script execution
- All network-level ad/tracker blocking is handled in the main process via `session.webRequest`
- No external analytics or telemetry is collected

---

*Leef Browser is developed by QTech.*
