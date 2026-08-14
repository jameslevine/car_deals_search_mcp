const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

/**
 * Car listing data structure
 */
class CarListing {
    constructor(data) {
        this.title = data.title || null;
        this.price = data.price || null;
        this.mileage = data.mileage || null;
        this.dealerName = data.dealerName || null;
        this.location = data.location || null;
        this.dealRating = data.dealRating || null;
        this.url = data.url || null;
        this.source = data.source || null;
        // CarFax badges
        this.isOneOwner = data.isOneOwner || false;
        this.noAccidents = data.noAccidents || false;
        this.personalUse = data.personalUse || false;
    }

    format() {
        let result = `${this.title || 'Unknown Vehicle'}`;
        if (this.price) result += `\n  Price: ${this.price}`;
        if (this.mileage) result += `\n  Mileage: ${this.mileage}`;
        if (this.dealRating) result += `\n  Deal Rating: ${this.dealRating}`;

        // CarFax badges
        const badges = [];
        if (this.isOneOwner) badges.push('1-Owner');
        if (this.noAccidents) badges.push('No Accidents');
        if (this.personalUse) badges.push('Personal Use');
        if (badges.length > 0) result += `\n  CarFax: ${badges.join(' | ')}`;

        if (this.dealerName) result += `\n  Dealer: ${this.dealerName}`;
        if (this.location) result += `\n  Location: ${this.location}`;
        if (this.source) result += `\n  Source: ${this.source}`;
        if (this.url) result += `\n  ${this.url}`;
        return result;
    }
}

/**
 * Parse a displayed price/mileage/year string into a comparable number.
 * Handles UK formats like "£17,110", "68,148 miles", and Motors.co.uk's "41.2k".
 */
function parsePrice(str) {
    if (!str) return null;
    const digits = str.replace(/[^\d]/g, '');
    return digits ? parseInt(digits, 10) : null;
}

function parseMileage(str) {
    if (!str) return null;
    const kMatch = str.match(/([\d.]+)\s*k/i);
    if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);
    const digits = str.replace(/[^\d]/g, '');
    return digits ? parseInt(digits, 10) : null;
}

function parseYear(str) {
    if (!str) return null;
    const match = str.match(/(19|20)\d{2}/);
    return match ? parseInt(match[0], 10) : null;
}

/**
 * Apply yearMin/yearMax/priceMax/mileageMax filters client-side, since not every
 * UK source reliably supports every filter as a URL/search parameter.
 */
function applyFilters(rawListings, params) {
    return rawListings.filter(item => {
        const year = parseYear(item.year);
        if (params.yearMin && year && year < params.yearMin) return false;
        if (params.yearMax && year && year > params.yearMax) return false;

        const price = parsePrice(item.price);
        if (params.priceMax && price && price > params.priceMax) return false;

        const mileage = parseMileage(item.mileage);
        if (params.mileageMax && mileage && mileage > params.mileageMax) return false;

        return true;
    });
}

/**
 * Launch browser with stealth settings
 */
async function launchBrowser() {
    return puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process'
        ]
    });
}

/**
 * Scrape Cars.com for car listings
 */
async function scrapeCarscom(params, maxResults = 20) {
    const listings = [];
    let browser;

    try {
        browser = await launchBrowser();
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });

        // Build URL
        let url = 'https://www.cars.com/shopping/results/?';
        const urlParams = new URLSearchParams();
        urlParams.append('stock_type', 'used');
        if (params.make) urlParams.append('makes[]', params.make.toLowerCase());
        if (params.model) urlParams.append('models[]', `${params.make.toLowerCase()}-${params.model.toLowerCase()}`);
        if (params.zip) urlParams.append('zip', params.zip);
        if (params.yearMin) urlParams.append('year_min', params.yearMin);
        if (params.yearMax) urlParams.append('year_max', params.yearMax);
        if (params.priceMax) urlParams.append('list_price_max', params.priceMax);
        if (params.mileageMax) urlParams.append('mileage_max', params.mileageMax);

        // CarFax history filters
        if (params.oneOwner) urlParams.append('one_owner', 'true');
        if (params.noAccidents) urlParams.append('no_accidents', 'true');
        if (params.personalUse) urlParams.append('personal_use', 'true');

        url += urlParams.toString();

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 5000));

        // Extract listings from .vehicle-card elements
        const rawListings = await page.evaluate(() => {
            const results = [];
            const cards = document.querySelectorAll('.vehicle-card');

            cards.forEach(card => {
                const text = card.innerText;
                const lines = text.split('\n').filter(l => l.trim());

                let title = null;
                let price = null;
                let mileage = null;
                let dealRating = null;
                let dealerName = null;
                let location = null;

                for (const line of lines) {
                    const trimmed = line.trim();

                    // Title: Year Make Model (e.g., "2020 Toyota Camry XSE")
                    if (/^(19|20)\d{2}\s+\w+/.test(trimmed) && !title) {
                        title = trimmed;
                        continue;
                    }

                    // Price: "$XX,XXX" (may have "price drop" suffix)
                    const priceMatch = trimmed.match(/^\$[\d,]+/);
                    if (priceMatch && !price) {
                        price = priceMatch[0];
                        continue;
                    }

                    // Mileage: "XX,XXX mi."
                    if (/^[\d,]+\s*mi\.?$/i.test(trimmed) && !mileage) {
                        mileage = trimmed;
                        continue;
                    }

                    // Deal rating: "Good Deal", "Great Deal", etc.
                    if (/^(great|good|fair|high|no price)/i.test(trimmed) && !dealRating) {
                        dealRating = trimmed.split('|')[0].trim();
                        continue;
                    }

                    // Location: "City, ST (XX mi.)"
                    if (/^[A-Z][a-z]+.*,\s*[A-Z]{2}\s*\(/i.test(trimmed) && !location) {
                        location = trimmed;
                        continue;
                    }
                }

                // Get dealer name - usually after reviews count
                const dealerMatch = card.querySelector('.dealer-name');
                if (dealerMatch) {
                    dealerName = dealerMatch.innerText.trim();
                } else {
                    // Fallback: look for line before reviews
                    for (let i = 0; i < lines.length; i++) {
                        if (lines[i].includes('reviews') && i > 0) {
                            dealerName = lines[i - 1].trim();
                            break;
                        }
                    }
                }

                // Get URL from the card link
                const linkEl = card.querySelector('a.vehicle-card-link');
                const href = linkEl ? linkEl.getAttribute('href') : null;

                // Check for CarFax badges
                const fullText = text.toLowerCase();
                const isOneOwner = fullText.includes('1-owner') || fullText.includes('one owner');
                const noAccidents = fullText.includes('no accident') || fullText.includes('clean');
                const personalUse = fullText.includes('personal use');

                if (title) {
                    results.push({ title, price, mileage, dealRating, dealerName, location, href, isOneOwner, noAccidents, personalUse });
                }
            });

            return results;
        });

        for (const item of rawListings.slice(0, maxResults)) {
            listings.push(new CarListing({
                title: item.title,
                price: item.price,
                mileage: item.mileage,
                dealerName: item.dealerName,
                dealRating: item.dealRating,
                url: item.href ? `https://www.cars.com${item.href}` : null,
                source: 'Cars.com',
                isOneOwner: item.isOneOwner,
                noAccidents: item.noAccidents,
                personalUse: item.personalUse
            }));
        }

        await browser.close();
    } catch (err) {
        if (browser) await browser.close();
        throw new Error(`Cars.com scraping failed: ${err.message}`);
    }

    return listings;
}

/**
 * Scrape Autotrader for car listings
 */
async function scrapeAutotrader(params, maxResults = 20) {
    const listings = [];
    let browser;

    try {
        browser = await launchBrowser();
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });

        // Build URL
        const make = params.make ? params.make.toLowerCase() : '';
        const model = params.model ? params.model.toLowerCase() : '';
        const zip = params.zip || '90210';

        let url = `https://www.autotrader.com/cars-for-sale/all-cars`;
        if (make) url += `/${make}`;
        if (model) url += `/${model}`;
        url += `/beverly-hills-ca-${zip}`;

        // Add query params
        const urlParams = new URLSearchParams();
        if (params.yearMin) urlParams.append('startYear', params.yearMin);
        if (params.yearMax) urlParams.append('endYear', params.yearMax);
        if (params.priceMax) urlParams.append('maxPrice', params.priceMax);
        if (params.mileageMax) urlParams.append('maxMileage', params.mileageMax);

        if (urlParams.toString()) {
            url += '?' + urlParams.toString();
        }

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 5000));

        // Extract listings
        const rawListings = await page.evaluate(() => {
            const results = [];

            // Autotrader uses various selectors for listings
            const cards = document.querySelectorAll('[data-cmp="inventoryListing"], .inventory-listing');

            cards.forEach(card => {
                const titleEl = card.querySelector('h2, .text-bold');
                const priceEl = card.querySelector('[data-cmp="firstPrice"], .first-price');
                const mileageEl = card.querySelector('.text-subdued-lighter');
                const dealerEl = card.querySelector('.dealer-name, .text-subdued');
                const linkEl = card.querySelector('a[href*="/cars-for-sale/"]');

                const title = titleEl ? titleEl.innerText.trim() : null;
                const price = priceEl ? priceEl.innerText.trim() : null;

                // Get mileage from text
                let mileage = null;
                if (mileageEl) {
                    const text = mileageEl.innerText;
                    const match = text.match(/([\d,]+)\s*miles?/i);
                    if (match) mileage = match[0];
                }

                if (title) {
                    results.push({
                        title,
                        price,
                        mileage,
                        dealerName: dealerEl ? dealerEl.innerText.trim() : null,
                        href: linkEl ? linkEl.getAttribute('href') : null
                    });
                }
            });

            return results;
        });

        for (const item of rawListings.slice(0, maxResults)) {
            listings.push(new CarListing({
                title: item.title,
                price: item.price,
                mileage: item.mileage,
                dealerName: item.dealerName,
                url: item.href ? `https://www.autotrader.com${item.href}` : null,
                source: 'Autotrader'
            }));
        }

        await browser.close();
    } catch (err) {
        if (browser) await browser.close();
        throw new Error(`Autotrader scraping failed: ${err.message}`);
    }

    return listings;
}

/**
 * Scrape KBB for car listings
 */
async function scrapeKBB(params, maxResults = 20) {
    const listings = [];
    let browser;

    try {
        browser = await launchBrowser();
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });

        // Build URL
        const make = params.make ? params.make.toLowerCase() : '';
        const model = params.model ? params.model.toLowerCase() : '';
        const zip = params.zip || '90210';

        let url = `https://www.kbb.com/cars-for-sale/all`;
        if (make) url += `/${make}`;
        if (model) url += `/${model}`;
        url += `/?zip=${zip}`;

        // Add filters
        if (params.yearMin) url += `&startYear=${params.yearMin}`;
        if (params.yearMax) url += `&endYear=${params.yearMax}`;
        if (params.priceMax) url += `&maxPrice=${params.priceMax}`;
        if (params.mileageMax) url += `&maxMileage=${params.mileageMax}`;

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 5000));

        // Extract listings - KBB uses inventoryListing data-cmp
        const rawListings = await page.evaluate(() => {
            const results = [];

            const cards = document.querySelectorAll('[data-cmp="inventoryListing"]');

            cards.forEach(card => {
                const text = card.innerText;
                if (!text || text.length < 20) return;

                const lines = text.split('\n').filter(l => l.trim());

                let title = null;
                let trim = null;
                let price = null;
                let mileage = null;
                let dealRating = null;

                for (const line of lines) {
                    const trimmed = line.trim();

                    // Title: Year Make Model
                    if (/^(19|20)\d{2}\s+\w+/.test(trimmed) && !title) {
                        title = trimmed;
                        continue;
                    }

                    // Trim (usually follows title, like "XSE" or "LE")
                    if (title && !trim && /^[A-Z]{1,4}$/.test(trimmed)) {
                        trim = trimmed;
                        continue;
                    }

                    // Price: "$XX,XXX" or just "XX,XXX" (KBB sometimes omits $)
                    const priceMatch = trimmed.match(/^\$?([\d,]+)$/);
                    if (priceMatch && !price && parseInt(priceMatch[1].replace(/,/g, '')) > 1000) {
                        price = trimmed.startsWith('$') ? trimmed : `$${trimmed}`;
                        continue;
                    }

                    // Mileage: "XXK mi" or "XX,XXX mi"
                    if (/^\d+K?\s*mi$/i.test(trimmed) && !mileage) {
                        mileage = trimmed;
                        continue;
                    }

                    // Deal rating: "Good Price", "Great Price", "Fair Price"
                    if (/^(good|great|fair|high)\s*(price|deal)/i.test(trimmed) && !dealRating) {
                        dealRating = trimmed;
                        continue;
                    }
                }

                if (title) {
                    if (trim) title = `${title} ${trim}`;
                    results.push({ title, price, mileage, dealRating });
                }
            });

            return results;
        });

        for (const item of rawListings.slice(0, maxResults)) {
            listings.push(new CarListing({
                title: item.title,
                price: item.price,
                mileage: item.mileage,
                dealRating: item.dealRating,
                source: 'KBB'
            }));
        }

        await browser.close();
    } catch (err) {
        if (browser) await browser.close();
        throw new Error(`KBB scraping failed: ${err.message}`);
    }

    return listings;
}

/**
 * Accept the Sourcepoint/OneTrust-style cookie consent banner if one is shown,
 * checking both the top-level page and any consent iframe.
 */
async function acceptConsent(page, selectors) {
    try {
        for (const sel of selectors) {
            const btn = await page.$(sel);
            if (btn) {
                await btn.click();
                return;
            }
        }
        for (const frame of page.frames()) {
            for (const sel of selectors) {
                const btn = await frame.$(sel).catch(() => null);
                if (btn) {
                    await btn.click();
                    return;
                }
            }
        }
    } catch (err) {
        // Consent banner not present or already dismissed - safe to continue
    }
}

/**
 * Scrape Autotrader UK for car listings
 */
async function scrapeAutotraderUK(params, maxResults = 20) {
    const listings = [];
    let browser;

    try {
        browser = await launchBrowser();
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });

        const postcode = (params.zip || 'SW1A1AA').replace(/\s+/g, '');
        const urlParams = new URLSearchParams();
        urlParams.append('postcode', postcode);
        if (params.make) urlParams.append('make', params.make);
        if (params.model) urlParams.append('model', params.model);
        if (params.yearMin) urlParams.append('year-from', params.yearMin);
        if (params.yearMax) urlParams.append('year-to', params.yearMax);
        if (params.priceMax) urlParams.append('price-to', params.priceMax);
        if (params.mileageMax) urlParams.append('maximum-mileage', params.mileageMax);

        const url = `https://www.autotrader.co.uk/car-search?${urlParams.toString()}`;

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 3000));
        await acceptConsent(page, ['button[title="Accept All"]', 'button[aria-label="Accept All"]']);
        await new Promise(r => setTimeout(r, 4000));

        const rawListings = await page.evaluate(() => {
            const results = [];
            const cards = document.querySelectorAll('[data-testid^="advertCard-"]');

            cards.forEach(card => {
                const titleEl = card.querySelector('[data-testid="search-listing-title"]');
                if (!titleEl) return;

                const title = titleEl.childNodes[0] ? titleEl.childNodes[0].textContent.trim() : null;
                if (!title) return;

                const subtitleEl = card.querySelector('[data-testid="search-listing-subtitle"]');
                const mileageEl = card.querySelector('[data-testid="mileage"]');
                const yearEl = card.querySelector('[data-testid="registered_year"]');
                const locationEl = card.querySelector('[data-testid="search-listing-location"]');
                const priceMatch = card.innerText.match(/£[\d,]+/);

                results.push({
                    title: subtitleEl ? `${title} ${subtitleEl.innerText.trim()}` : title,
                    price: priceMatch ? priceMatch[0] : null,
                    mileage: mileageEl ? mileageEl.innerText.trim() : null,
                    year: yearEl ? yearEl.innerText.trim() : null,
                    location: locationEl ? locationEl.innerText.trim() : null,
                    href: titleEl.getAttribute('href'),
                });
            });

            return results;
        });

        const filtered = applyFilters(rawListings, params);
        for (const item of filtered.slice(0, maxResults)) {
            listings.push(new CarListing({
                title: item.title,
                price: item.price,
                mileage: item.mileage,
                location: item.location,
                url: item.href ? `https://www.autotrader.co.uk${item.href}` : null,
                source: 'Autotrader UK',
            }));
        }

        await browser.close();
    } catch (err) {
        if (browser) await browser.close();
        throw new Error(`Autotrader UK scraping failed: ${err.message}`);
    }

    return listings;
}

/**
 * Scrape Motors.co.uk for car listings
 */
async function scrapeMotorsUK(params, maxResults = 20) {
    const listings = [];
    let browser;

    try {
        browser = await launchBrowser();
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });

        const postcode = (params.zip || 'SW1A1AA').replace(/\s+/g, '');
        const urlParams = new URLSearchParams();
        if (params.make) urlParams.append('make', params.make);
        if (params.model) urlParams.append('model', params.model);
        urlParams.append('postcode', postcode);
        if (params.yearMin) urlParams.append('MinYear', params.yearMin);
        if (params.yearMax) urlParams.append('MaxYear', params.yearMax);
        if (params.priceMax) urlParams.append('MaxPrice', params.priceMax);

        const url = `https://www.motors.co.uk/search/car/?${urlParams.toString()}`;

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 3000));
        await acceptConsent(page, ['#onetrust-accept-btn-handler']);
        await new Promise(r => setTimeout(r, 4000));

        const rawListings = await page.evaluate(() => {
            const results = [];
            const cards = document.querySelectorAll('.result-card');

            cards.forEach(card => {
                const titleEl = card.querySelector('.result-card__header h3');
                if (!titleEl) return;

                const title = titleEl.innerText.trim().replace(',', '');
                const subtitleEl = card.querySelector('.result-card__header h4');
                const linkEl = card.querySelector('.result-card__link');

                const text = card.innerText;
                const priceMatch = text.match(/£[\d,]+/);
                const mileageMatch = text.match(/(\d+(?:\.\d+)?k)\s*\n\s*Miles/i);
                const distanceMatch = text.match(/\d+\s*miles away/i);

                if (title) {
                    results.push({
                        title: subtitleEl ? `${title} ${subtitleEl.innerText.trim()}` : title,
                        price: priceMatch ? priceMatch[0] : null,
                        mileage: mileageMatch ? mileageMatch[1] : null,
                        year: subtitleEl ? subtitleEl.innerText.trim() : null,
                        location: distanceMatch ? distanceMatch[0] : null,
                        href: linkEl ? linkEl.getAttribute('href') : null,
                    });
                }
            });

            return results;
        });

        const filtered = applyFilters(rawListings, params);
        for (const item of filtered.slice(0, maxResults)) {
            listings.push(new CarListing({
                title: item.title,
                price: item.price,
                mileage: item.mileage,
                location: item.location,
                url: item.href ? `https://www.motors.co.uk${item.href}` : null,
                source: 'Motors.co.uk',
            }));
        }

        await browser.close();
    } catch (err) {
        if (browser) await browser.close();
        throw new Error(`Motors.co.uk scraping failed: ${err.message}`);
    }

    return listings;
}

/**
 * Scrape Cinch (cinch.co.uk) for car listings.
 * Cinch is a nationwide UK used-car retailer with home delivery, so listings
 * aren't scoped to a postcode/dealer distance the way the other UK sources are.
 */
async function scrapeCinch(params, maxResults = 20) {
    const listings = [];
    let browser;

    try {
        browser = await launchBrowser();
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });

        const slugify = s => s.toLowerCase().trim().replace(/\s+/g, '-');
        const make = params.make ? slugify(params.make) : '';
        const model = params.model ? slugify(params.model) : '';

        let url = 'https://www.cinch.co.uk/used-cars';
        if (make) url += `/${make}`;
        if (model) url += `/${model}`;

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 5000));

        const rawListings = await page.evaluate(() => {
            const results = [];
            const cards = document.querySelectorAll('li:has(a[data-testid="product-list-card-link"])');

            cards.forEach(card => {
                const linkEl = card.querySelector('a[data-testid="product-list-card-link"]');
                if (!linkEl) return;

                const lines = card.innerText.split('\n').map(l => l.trim()).filter(Boolean);
                const title = lines[0] || null;
                const subtitle = lines[1] || null;

                const findAfter = label => {
                    const idx = lines.indexOf(label);
                    return idx >= 0 ? lines[idx + 1] : null;
                };

                if (title) {
                    results.push({
                        title: subtitle ? `${title} ${subtitle}` : title,
                        price: findAfter('Full price.'),
                        mileage: findAfter('Mileage,'),
                        year: findAfter('Vehicle year,'),
                        href: linkEl.getAttribute('href'),
                    });
                }
            });

            return results;
        });

        const filtered = applyFilters(rawListings, params);
        for (const item of filtered.slice(0, maxResults)) {
            listings.push(new CarListing({
                title: item.title,
                price: item.price,
                mileage: item.mileage,
                url: item.href ? `https://www.cinch.co.uk${item.href}` : null,
                source: 'Cinch',
            }));
        }

        await browser.close();
    } catch (err) {
        if (browser) await browser.close();
        throw new Error(`Cinch scraping failed: ${err.message}`);
    }

    return listings;
}

/**
 * Search all sources and combine results
 */
async function searchAllSources(params, maxResultsPerSource = 10) {
    const results = {
        listings: [],
        errors: []
    };

    // Run scrapers in parallel
    const scrapers = [
        { name: 'Cars.com', fn: () => scrapeCarscom(params, maxResultsPerSource) },
        { name: 'Autotrader', fn: () => scrapeAutotrader(params, maxResultsPerSource) },
        { name: 'KBB', fn: () => scrapeKBB(params, maxResultsPerSource) }
    ];

    const promises = scrapers.map(async scraper => {
        try {
            const listings = await scraper.fn();
            return { name: scraper.name, listings, error: null };
        } catch (err) {
            return { name: scraper.name, listings: [], error: err.message };
        }
    });

    const outcomes = await Promise.all(promises);

    for (const outcome of outcomes) {
        results.listings.push(...outcome.listings);
        if (outcome.error) {
            results.errors.push({ source: outcome.name, error: outcome.error });
        }
    }

    return results;
}

module.exports = {
    CarListing,
    scrapeCarscom,
    scrapeAutotrader,
    scrapeKBB,
    scrapeAutotraderUK,
    scrapeMotorsUK,
    scrapeCinch,
    searchAllSources
};
