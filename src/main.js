import crypto from 'node:crypto';
import { Actor, log } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const {
    startUrls = [],
    keywords = [],
    priceCurrencies = ['USD', 'EGP', 'CAD', 'GBP', 'EUR', 'INR', 'PHP', 'TRY', 'BRL', 'AED', 'SGD'],
    includeBaseline = false,
    onlyMeaningfulChanges = true,
    maxPages = 25,
    webhookUrl = '',
} = input;

const normalizedKeywords = keywords.map((k) => String(k).trim().toLowerCase()).filter(Boolean);
const currencyCodes = priceCurrencies.map((c) => String(c).trim().toUpperCase()).filter(Boolean);
const state = await Actor.openKeyValueStore('DEAL_MONITOR_STATE');
const findings = [];

const hashText = (value) => crypto.createHash('sha256').update(value).digest('hex');
const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const domainOf = (url) => {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
};

function extractPriceSnippets(text) {
    const snippets = new Set();
    const patterns = [
        /(?:US\$|CA\$|A\$|S\$|\$|€|£|₹|₱|₺|R\$|AED\s?|EGP\s?|SGD\s?)\s?\d[\d,.]*(?:\.\d{1,2})?(?:\s?\/?\s?(?:month|mo|year|yr))?/gi,
        /\b(?:USD|EGP|CAD|GBP|EUR|INR|PHP|TRY|BRL|AED|SGD)\s?\d[\d,.]*(?:\.\d{1,2})?/gi,
        /\b\d{1,3}%\s+(?:off|discount|back|savings?)\b/gi,
        /\b(?:\d+|one|two|three|four|five|six|twelve)\s+months?\s+free\b/gi,
    ];
    for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) snippets.add(clean(match[0]));
    }
    for (const code of currencyCodes) {
        const idx = text.toUpperCase().indexOf(code);
        if (idx >= 0) snippets.add(clean(text.slice(Math.max(0, idx - 45), Math.min(text.length, idx + 85))));
    }
    return [...snippets].slice(0, 30);
}

function keywordMatches(text) {
    const lower = text.toLowerCase();
    return normalizedKeywords.filter((k) => lower.includes(k)).slice(0, 40);
}

function bestExcerpt(text, matches, prices) {
    const lower = text.toLowerCase();
    let index = -1;
    if (prices[0]) index = lower.indexOf(prices[0].toLowerCase());
    if (index < 0 && matches[0]) index = lower.indexOf(matches[0]);
    if (index < 0) index = 0;
    return clean(text.slice(Math.max(0, index - 300), Math.min(text.length, index + 900))).slice(0, 1400);
}

const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: Math.min(Number(maxPages) || 25, 100),
    maxConcurrency: 4,
    requestHandlerTimeoutSecs: 90,
    launchContext: {
        launchOptions: { headless: true },
    },
    async requestHandler({ request, page, response }) {
        const url = request.loadedUrl || request.url;
        const status = response?.status() ?? null;

        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await page.waitForTimeout(1800);

        const pageData = await page.evaluate(() => {
            const remove = ['script', 'style', 'noscript', 'svg', 'canvas'];
            for (const selector of remove) document.querySelectorAll(selector).forEach((el) => el.remove());
            const title = document.title || '';
            const metaDescription = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
            const text = document.body?.innerText || '';
            return { title, metaDescription, text };
        });

        const fullText = clean(`${pageData.title} ${pageData.metaDescription} ${pageData.text}`).slice(0, 250000);
        const contentHash = hashText(fullText);
        const key = `URL_${hashText(url).slice(0, 32)}`;
        const previous = await state.getValue(key);
        const isBaseline = !previous;
        const changed = Boolean(previous && previous.hash !== contentHash);
        const matches = keywordMatches(fullText);
        const prices = extractPriceSnippets(fullText);
        const meaningful = matches.length > 0 || prices.length > 0;

        await state.setValue(key, {
            url,
            hash: contentHash,
            checkedAt: new Date().toISOString(),
            title: clean(pageData.title),
            prices,
        });

        const shouldOutput = isBaseline ? includeBaseline : changed;
        if (shouldOutput && (!onlyMeaningfulChanges || meaningful)) {
            const item = {
                checkedAt: new Date().toISOString(),
                domain: domainOf(url),
                url,
                status,
                title: clean(pageData.title),
                isBaseline,
                changed,
                matchedKeywords: matches,
                priceSnippets: prices,
                priorPriceSnippets: previous?.prices ?? [],
                excerpt: bestExcerpt(fullText, matches, prices),
            };
            findings.push(item);
            await Actor.pushData(item);
        }

        log.info(`${isBaseline ? 'Baseline' : changed ? 'Changed' : 'No change'}: ${url}`, {
            keywordMatches: matches.length,
            priceMatches: prices.length,
        });
    },
    failedRequestHandler: async ({ request }, error) => {
        const item = {
            checkedAt: new Date().toISOString(),
            domain: domainOf(request.url),
            url: request.url,
            status: 'FAILED',
            changed: false,
            error: error?.message || String(error),
        };
        await Actor.pushData(item);
        log.error(`Failed: ${request.url}`, { error: item.error });
    },
});

await crawler.run(startUrls.slice(0, maxPages));

if (webhookUrl && findings.length > 0) {
    try {
        const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                source: 'apify-ai-deal-monitor',
                runId: Actor.getEnv().actorRunId,
                count: findings.length,
                findings,
            }),
        });
        if (!res.ok) log.warning(`Webhook returned HTTP ${res.status}`);
    } catch (error) {
        log.warning('Webhook delivery failed', { error: error?.message || String(error) });
    }
}

await Actor.setValue('SUMMARY', {
    checkedAt: new Date().toISOString(),
    pagesRequested: Math.min(startUrls.length, maxPages),
    findings: findings.length,
    note: findings.length ? 'Meaningful page changes detected.' : 'No meaningful changes detected.'
});

await Actor.exit();
