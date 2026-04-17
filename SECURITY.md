# Security Policy

## Supported Versions

The following versions of Leef Browser currently receive security updates:

| Version | Supported          |
| ------- | ------------------ |
| 0.x     | ✅ Active support  |

---

## Reporting a Vulnerability

We take security seriously. If you discover a vulnerability in Leef Browser, **please do not open a public GitHub issue**.

Instead, report it privately so we can address it before public disclosure:

- **Email:** security@qtechdev.com *(replace with your actual contact)*
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
- `contextIsolation: false` / `nodeIntegration: true` — required for the current renderer architecture; a future update will migrate to a preload-based IPC model
- All network-level ad/tracker blocking is handled in the main process via `session.webRequest`
- No external analytics or telemetry is collected

---

*Leef Browser is developed by QTech.*
