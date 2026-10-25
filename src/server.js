#!/usr/bin/env node

/**
 * Car Deals MCP Server
 * 
 * An MCP server that searches for car deals from Cars.com, Autotrader, and KBB.
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const {
    searchAllSources,
    scrapeCarscom,
    scrapeAutotrader,
    scrapeKBB,
    scrapeAutotraderUK,
    scrapeMotorsUK,
    scrapeCinch,
} = require('./scraper.js');
const { fence } = require('./untrusted.js');

// Create server instance
const server = new Server(
    {
        name: 'car-deals-mcp',
        version: '1.0.0',
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

const MAX_TEXT = 60;

const TOOLS = [
    {
        name: 'search_car_deals',
        // Read-only by design: the tool only fetches public listing pages. It has no
        // write tools, and any added later must follow the preview + confirm-token
        // pattern in jameslevine/claude-setup rules/mcp-servers.md.
        annotations: {
            title: 'Search car deals',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
        description: 'Search for car deals across multiple sources. US: Cars.com, Autotrader, KBB. UK: Autotrader UK, Motors.co.uk, Cinch. Returns listings with prices, mileage, deal ratings, and links.',
        inputSchema: {
            type: 'object',
            properties: {
                make: {
                    type: 'string',
                    maxLength: MAX_TEXT,
                    description: 'Car manufacturer (e.g., Toyota, Honda, Ford)',
                },
                model: {
                    type: 'string',
                    maxLength: MAX_TEXT,
                    description: 'Car model (e.g., Camry, Civic, F-150)',
                },
                country: {
                    type: 'string',
                    enum: ['US', 'UK'],
                    description: 'Country to search in. Default: US',
                },
                zip: {
                    type: 'string',
                    maxLength: MAX_TEXT,
                    description: 'ZIP code (US) or postcode (UK) for location-based search (default: 90210 for US, SW1A 1AA for UK)',
                },
                yearMin: {
                    type: 'integer',
                    description: 'Minimum model year',
                },
                yearMax: {
                    type: 'integer',
                    description: 'Maximum model year',
                },
                priceMax: {
                    type: 'integer',
                    description: 'Maximum price in dollars',
                },
                mileageMax: {
                    type: 'integer',
                    description: 'Maximum mileage',
                },
                maxResults: {
                    type: 'integer',
                    description: 'Maximum results per source (default: 10)',
                },
                sources: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Sources to search. US: "cars.com", "autotrader", "kbb". UK: "autotrader-uk", "motors", "cinch". Default: cars.com (US) or autotrader-uk (UK)',
                },
                oneOwner: {
                    type: 'boolean',
                    description: 'Filter for CARFAX 1-Owner vehicles only',
                },
                noAccidents: {
                    type: 'boolean',
                    description: 'Filter for vehicles with no accidents or damage reported',
                },
                personalUse: {
                    type: 'boolean',
                    description: 'Filter for vehicles used for personal use only (not rental/fleet)',
                },
            },
            required: ['make', 'model'],
        },
    },
];

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

/**
 * Check the arguments at the boundary, since the low-level Server doesn't apply
 * the input schema. Returns a message for the first problem, or null.
 */
function validateArgs(args) {
    for (const key of ['make', 'model']) {
        if (typeof args[key] !== 'string' || !args[key].trim()) return `${key} must be a non-empty string`;
    }
    for (const key of ['make', 'model', 'zip']) {
        if (args[key] !== undefined && (typeof args[key] !== 'string' || args[key].length > MAX_TEXT)) {
            return `${key} must be a string of at most ${MAX_TEXT} characters`;
        }
    }
    if (args.country !== undefined && !['US', 'UK'].includes(String(args.country).toUpperCase())) {
        return 'country must be "US" or "UK"';
    }
    for (const key of ['yearMin', 'yearMax', 'priceMax', 'mileageMax', 'maxResults']) {
        if (args[key] !== undefined && !(Number.isInteger(args[key]) && args[key] >= 0)) {
            return `${key} must be a whole number`;
        }
    }
    if (args.sources !== undefined && !(Array.isArray(args.sources) && args.sources.every(x => typeof x === 'string'))) {
        return 'sources must be an array of strings';
    }
    return null;
}

/**
 * Build the tool's text output. The search summary echoes the caller's own
 * arguments; the listings and scraper errors come from third-party pages, so
 * they go inside the untrusted-data fence.
 */
function formatResults(params, country, allListings, errors) {
    let output = `# Car Deals Search Results\n\n`;
    output += `**Search:** ${params.make} ${params.model}`;
    if (params.yearMin || params.yearMax) {
        output += ` (${params.yearMin || 'any'}-${params.yearMax || 'any'})`;
    }
    const currencySymbol = country === 'UK' ? '£' : '$';
    if (params.priceMax) output += ` | Max Price: ${currencySymbol}${params.priceMax.toLocaleString()}`;
    if (params.mileageMax) output += ` | Max Mileage: ${params.mileageMax.toLocaleString()}`;

    // Show active CarFax filters
    const activeFilters = [];
    if (params.oneOwner) activeFilters.push('1-Owner');
    if (params.noAccidents) activeFilters.push('No Accidents');
    if (params.personalUse) activeFilters.push('Personal Use');
    if (activeFilters.length > 0) output += `\n**CarFax Filters:** ${activeFilters.join(', ')}`;

    output += `\n**Location:** ${params.zip}\n\n`;

    let scraped = '';
    if (allListings.length === 0) {
        scraped += `No listings found.\n`;
    } else {
        output += `Found **${allListings.length}** listings.\n\n`;
        for (const listing of allListings) {
            scraped += listing.format() + '\n\n---\n\n';
        }
    }

    if (errors.length > 0) {
        scraped += `\n**Errors:**\n`;
        for (const err of errors) {
            scraped += `- ${err}\n`;
        }
    }

    return output + fence(scraped);
}

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === 'search_car_deals') {
        const problem = validateArgs(args || {});
        if (problem) {
            return { content: [{ type: 'text', text: `Invalid arguments: ${problem}` }], isError: true };
        }
        try {
            const country = (args.country || 'US').toUpperCase();
            const defaultZip = country === 'UK' ? 'SW1A 1AA' : '90210';
            const params = {
                make: args.make,
                model: args.model,
                country,
                zip: args.zip || defaultZip,
                yearMin: args.yearMin,
                yearMax: args.yearMax,
                priceMax: args.priceMax,
                mileageMax: args.mileageMax,
                // CarFax history filters (US only)
                oneOwner: args.oneOwner,
                noAccidents: args.noAccidents,
                personalUse: args.personalUse,
            };
            const maxResults = args.maxResults || 10;
            // Default to just one source per country for reliability
            const defaultSources = country === 'UK' ? ['autotrader-uk'] : ['cars.com'];
            const sources = args.sources || defaultSources;

            console.error(`[MCP] Searching for ${params.make} ${params.model} in ${params.zip}`);
            console.error(`[MCP] Sources: ${sources.join(', ')}, Max: ${maxResults}`);

            let allListings = [];
            let errors = [];

            // Run selected scrapers
            const scraperPromises = [];

            if (sources.includes('cars.com')) {
                console.error('[MCP] Starting Cars.com scraper...');
                scraperPromises.push(
                    scrapeCarscom(params, maxResults)
                        .then(listings => {
                            console.error(`[MCP] Cars.com returned ${listings.length} listings`);
                            return { source: 'Cars.com', listings };
                        })
                        .catch(err => {
                            console.error(`[MCP] Cars.com error: ${err.message}`);
                            return { source: 'Cars.com', error: err.message, listings: [] };
                        })
                );
            }

            if (sources.includes('autotrader')) {
                console.error('[MCP] Starting Autotrader scraper...');
                scraperPromises.push(
                    scrapeAutotrader(params, maxResults)
                        .then(listings => {
                            console.error(`[MCP] Autotrader returned ${listings.length} listings`);
                            return { source: 'Autotrader', listings };
                        })
                        .catch(err => {
                            console.error(`[MCP] Autotrader error: ${err.message}`);
                            return { source: 'Autotrader', error: err.message, listings: [] };
                        })
                );
            }

            if (sources.includes('kbb')) {
                console.error('[MCP] Starting KBB scraper...');
                scraperPromises.push(
                    scrapeKBB(params, maxResults)
                        .then(listings => {
                            console.error(`[MCP] KBB returned ${listings.length} listings`);
                            return { source: 'KBB', listings };
                        })
                        .catch(err => {
                            console.error(`[MCP] KBB error: ${err.message}`);
                            return { source: 'KBB', error: err.message, listings: [] };
                        })
                );
            }

            if (sources.includes('autotrader-uk')) {
                console.error('[MCP] Starting Autotrader UK scraper...');
                scraperPromises.push(
                    scrapeAutotraderUK(params, maxResults)
                        .then(listings => {
                            console.error(`[MCP] Autotrader UK returned ${listings.length} listings`);
                            return { source: 'Autotrader UK', listings };
                        })
                        .catch(err => {
                            console.error(`[MCP] Autotrader UK error: ${err.message}`);
                            return { source: 'Autotrader UK', error: err.message, listings: [] };
                        })
                );
            }

            if (sources.includes('motors')) {
                console.error('[MCP] Starting Motors.co.uk scraper...');
                scraperPromises.push(
                    scrapeMotorsUK(params, maxResults)
                        .then(listings => {
                            console.error(`[MCP] Motors.co.uk returned ${listings.length} listings`);
                            return { source: 'Motors.co.uk', listings };
                        })
                        .catch(err => {
                            console.error(`[MCP] Motors.co.uk error: ${err.message}`);
                            return { source: 'Motors.co.uk', error: err.message, listings: [] };
                        })
                );
            }

            if (sources.includes('cinch')) {
                console.error('[MCP] Starting Cinch scraper...');
                scraperPromises.push(
                    scrapeCinch(params, maxResults)
                        .then(listings => {
                            console.error(`[MCP] Cinch returned ${listings.length} listings`);
                            return { source: 'Cinch', listings };
                        })
                        .catch(err => {
                            console.error(`[MCP] Cinch error: ${err.message}`);
                            return { source: 'Cinch', error: err.message, listings: [] };
                        })
                );
            }

            const results = await Promise.all(scraperPromises);
            console.error(`[MCP] All scrapers completed`);

            for (const result of results) {
                allListings.push(...result.listings);
                if (result.error) {
                    errors.push(`${result.source}: ${result.error}`);
                }
            }

            console.error(`[MCP] Total listings: ${allListings.length}`);

            const output = formatResults(params, country, allListings, errors);

            return {
                content: [
                    {
                        type: 'text',
                        text: output,
                    },
                ],
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error searching for car deals: ${error.message}`,
                    },
                ],
                isError: true,
            };
        }
    }

    throw new Error(`Unknown tool: ${name}`);
});

// Start server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Car Deals MCP Server running on stdio');
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { TOOLS, validateArgs, formatResults };
