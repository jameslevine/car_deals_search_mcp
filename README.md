# Car Deals Search MCP

> **Search used car listings from Cars.com, Autotrader, KBB (US) and Autotrader UK, Motors.co.uk, Cinch (UK) with AI assistants**

An MCP (Model Context Protocol) server that aggregates and searches car listings from multiple sources across the US and UK. Scrapes listings in parallel, extracts price, mileage, dealer info, and applies optional CARFAX-style filters (1-owner, no accidents, personal use) for US sources.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> This is a fork of [SiddarthaKoppaka/car_deals_search_mcp](https://github.com/SiddarthaKoppaka/car_deals_search_mcp), extended with UK marketplace support (Autotrader UK, Motors.co.uk, Cinch).

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** (v16 or higher)
- **Chrome/Chromium** browser installed (required by Puppeteer)
  - If Chrome is not in the default location, set `PUPPETEER_EXECUTABLE_PATH` environment variable to point to your Chrome/Chromium binary

### Installation

```bash
# Clone the repository
git clone https://github.com/jameslevine/car_deals_search_mcp.git
cd car_deals_search_mcp

# Install dependencies (includes Puppeteer)
npm install
```

### Using with MCP Clients

Configure your MCP client (Claude Desktop, VS Code, GitHub Copilot, etc.) to use this server:

**For Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "car-deals": {
      "command": "node",
      "args": ["/absolute/path/to/car_deals_search_mcp/src/server.js"]
    }
  }
}
```

**For other MCP clients**, refer to their documentation and use:
- **Command**: `node`
- **Args**: `["<absolute-path-to-repo>/src/server.js"]`

### Testing Standalone

```bash
# Run the offline tests, then a live search
npm test
npm run smoke

# Or test manually with a specific search (US)
node -e "
const { scrapeCarscom } = require('./src/scraper.js');
scrapeCarscom({
  make: 'Toyota',
  model: 'Camry',
  oneOwner: true,
  noAccidents: true,
  personalUse: true
}, 5).then(listings => listings.forEach(l => console.log(l.format())));
"

# Or test a UK search
node -e "
const { scrapeAutotraderUK } = require('./src/scraper.js');
scrapeAutotraderUK({
  make: 'Toyota',
  model: 'Corolla',
  zip: 'SW1A 1AA',
  priceMax: 15000
}, 5).then(listings => listings.forEach(l => console.log(l.format())));
"
```

---

## ✨ Features

- **Multi-source aggregation**: Search Cars.com, Autotrader, and KBB (US), or Autotrader UK, Motors.co.uk, and Cinch (UK) simultaneously
- **US & UK support**: Pass `country: "UK"` to search UK marketplaces with a postcode instead of a ZIP code
- **Smart filtering**: CARFAX-style filters (1-Owner, No Accidents, Personal Use) for US sources
- **Deal ratings**: Heuristic-based deal quality assessment
- **Parallel scraping**: Fast concurrent queries across sources
- **Stealth mode**: Puppeteer with anti-bot detection techniques

---

## 📊 Supported Sources

**US** (`country: "US"`, default)

| Source     | Price | Mileage | Deal Rating | Dealer Info | CARFAX Filters |
|------------|:-----:|:-------:|:-----------:|:-----------:|:--------------:|
| Cars.com   | ✅    | ✅      | ✅          | ✅          | ✅             |
| Autotrader | ✅    | ✅      | ⚠️ Limited   | ✅          | ⚠️ Limited     |
| KBB        | ✅    | ✅      | ✅          | ⚠️ Limited   | ⚠️ Limited     |

**UK** (`country: "UK"`)

| Source        | Price | Mileage | Location | Notes |
|---------------|:-----:|:-------:|:--------:|-------|
| Autotrader UK | ✅    | ✅      | ✅       | Default UK source; searched by postcode |
| Motors.co.uk  | ✅    | ✅ (approx.) | ✅ (distance) | Mileage shown rounded (e.g. "41.2k") |
| Cinch         | ✅    | ✅      | ❌       | Nationwide delivery retailer, no postcode/distance |

---

## 🔧 MCP Tool: `search_car_deals`

### Parameters

| Parameter    | Type     | Required | Description |
|--------------|----------|----------|-------------|
| `make`       | string   | ✅       | Car manufacturer (e.g., "Toyota", "Honda") |
| `model`      | string   | ✅       | Car model (e.g., "Camry", "Accord") |
| `country`    | string   | ❌       | `"US"` or `"UK"` (default: `"US"`) |
| `zip`        | string   | ❌       | ZIP code (US) or postcode (UK) (default: "90210" for US, "SW1A 1AA" for UK) |
| `yearMin`    | integer  | ❌       | Minimum model year |
| `yearMax`    | integer  | ❌       | Maximum model year |
| `priceMax`   | integer  | ❌       | Maximum price, in USD for US searches or GBP for UK searches |
| `mileageMax` | integer  | ❌       | Maximum mileage |
| `maxResults` | integer  | ❌       | Max results per source (default: 10) |
| `sources`    | array    | ❌       | US: `["cars.com","autotrader","kbb"]`. UK: `["autotrader-uk","motors","cinch"]`. (default: `cars.com` for US, `autotrader-uk` for UK) |
| `oneOwner`   | boolean  | ❌       | US only. Filter for CARFAX 1-owner vehicles only |
| `noAccidents`| boolean  | ❌       | US only. Filter for no accidents reported |
| `personalUse`| boolean  | ❌       | US only. Filter for personal use only (not rental/fleet) |

### Example Response (US)

```text
🚗 2021 Toyota Camry XSE
   💰 Price: $23,491
   📏 Mileage: 52,649 mi
   ⭐ Deal Rating: Good Deal
   🏆 CARFAX: 1-Owner | No Accidents | Personal Use
   🏪 Dealer: Valencia BMW
   🌐 Source: Cars.com
   🔗 https://www.cars.com/vehicledetail/...
```

### Example Response (UK)

```text
Toyota Corolla 1.8 VVT-h Icon CVT Euro 6 (s/s) 5dr
  Price: £14,309
  Mileage: 56,847 miles
  Location: Available from Portsmouth (62 miles)
  Source: Autotrader UK
  https://www.autotrader.co.uk/car-details/...
```

---

## 🔒 Safety

This server follows the own-MCP-server policy in
[`jameslevine/claude-setup` `rules/mcp-servers.md`](https://github.com/jameslevine/claude-setup/blob/main/rules/mcp-servers.md):

- **Read-only.** `search_car_deals` only fetches public listing pages. It is annotated
  `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: true`. There are no write
  tools. Any added later must be off by default (an explicit opt-in such as `ALLOW_WRITES=1`)
  and must take a preview plus a one-time confirm token before changing anything.
- **Scraped text is untrusted data.** Listing fields are cleaned (control, zero-width and
  bidirectional characters removed, angle brackets defanged, length capped, non-http(s) links
  dropped). They come back inside an `<untrusted-data>` block with a notice telling the client
  not to follow any instructions in it.
- **Arguments are checked** before any page loads (required strings, lengths, whole numbers,
  `US`/`UK`).
- **No tokens.** The scrapers need no API keys. If a source ever does, read the key at start-up
  from the macOS Keychain or 1Password (`op run` with an `.env.tpl`), never from `mcp.json` or
  arguments.

`npm test` runs these checks (`node --test`, no browser or network). `npm run smoke` runs a live
Cars.com search.

---

## 🛠️ Technical Details

- **Scraping**: Puppeteer (headless Chromium) with stealth plugin to bypass bot detection
- **Concurrency**: Parallel scraper workers for simultaneous multi-source queries
- **Protocol**: Implements MCP (Model Context Protocol) for AI assistant integration
- **Data extraction**: Source-specific parsers normalize listings into a common schema

### Chrome/Chromium Requirement

This project uses Puppeteer, which requires Chrome or Chromium to be installed:

- **macOS**: Chrome is typically at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
- **Linux**: Usually auto-detected by Puppeteer or at `/usr/bin/chromium-browser`
- **Windows**: Typically at `C:\Program Files\Google\Chrome\Application\chrome.exe`

If Puppeteer cannot find your browser, set the environment variable:

```bash
export PUPPETEER_EXECUTABLE_PATH="/path/to/chrome"
```

---

## 🧪 Development & Testing

```bash
# Run tests (offline)
npm test

# Live search against Cars.com
npm run smoke

# Test individual scrapers
node src/scraper.js

# View code structure
ls -la src/
```

---

## 🤝 Contributing

Contributions are welcome! Please follow this workflow:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Add tests for new functionality
4. Commit your changes (`git commit -m 'Add amazing feature'`)
5. Push to the branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

Please include test coverage for scraping/parsing changes to avoid regressions when source sites update.

---

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details

---

## 🔗 Links

- **Repository**: [github.com/jameslevine/car_deals_search_mcp](https://github.com/jameslevine/car_deals_search_mcp)
- **Issues**: [github.com/jameslevine/car_deals_search_mcp/issues](https://github.com/jameslevine/car_deals_search_mcp/issues)
- **Original project**: [github.com/SiddarthaKoppaka/car_deals_search_mcp](https://github.com/SiddarthaKoppaka/car_deals_search_mcp)
- **MCP Protocol**: [modelcontextprotocol.io](https://modelcontextprotocol.io)
