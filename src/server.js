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

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: 'search_car_deals',
                description: 'Search for car deals across multiple sources. US: Cars.com, Autotrader, KBB. UK: Autotrader UK, Motors.co.uk, Cinch. Returns listings with prices, mileage, deal ratings, and links.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        make: {
                            type: 'string',
                            description: 'Car manufacturer (e.g., Toyota, Honda, Ford)',
                        },
                        model: {
                            type: 'string',
                            description: 'Car model (e.g., Camry, Civic, F-150)',
                        },
                        country: {
                            type: 'string',
                            enum: ['US', 'UK'],
                            description: 'Country to search in. Default: US',
                        },
                        zip: {
                            type: 'string',
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
        ],
    };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === 'search_car_deals') {
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

            // Format output
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

            if (allListings.length === 0) {
                output += `No listings found.\n`;
            } else {
                output += `Found **${allListings.length}** listings:\n\n`;

                for (const listing of allListings) {
                    output += listing.format() + '\n\n---\n\n';
                }
            }

            if (errors.length > 0) {
                output += `\n**Errors:**\n`;
                for (const err of errors) {
                    output += `- ${err}\n`;
                }
            }

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

main().catch(console.error);
