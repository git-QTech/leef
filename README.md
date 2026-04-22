# Leef Browser
A fast, lightweight Chromium browser built with one purpose. No AI overviews, no slop, no bloat, just browsing.

## Features
- **Privacy First**: Integrated ad-blocking, tracker protection, and a strict local-only data policy.
- **AI-Free Search**: Built-in blocking for Google AI Overviews to keep your results clean.
- **Speed**: Optimized for rapid page loads with a minimalist, modern UI.
- **No Telemetry**: Leef collects zero analytics or tracking data.*

## Security
Leef is actively maintained with security updates and a clear response policy — critical patches
are issued within 14 days of a verified report. If you discover a vulnerability, please report
it. See [SECURITY](SECURITY.md) for full details.


## Download
1. Go to the [Releases](https://github.com/Zexerif/leef/releases) page.
2. Download the latest `.exe` installer and run it.

> [!NOTE]
> You may see a "Windows protected your PC" SmartScreen warning on first run. Click **More Info → Run Anyway** to proceed.

## Build from Source
1. Clone the repo: `git clone https://github.com/Zexerif/leef.git`
2. Install dependencies: `npm install`
3. Run in dev mode: `npm start`
4. Build installer: `npm run dist`

## License
This project is released under [CC0 1.0 Universal](LICENSE) So it's effectively public domain.
Take it, fork it, build on it, sell it. No strings attached, we dont care. Although we'd appreciate nothing
that misrepresents or reflects poorly on the our project.


*As a Chromium-based browser, some background communication may occur at the engine level outside of our control.*
