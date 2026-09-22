# AI Deal & Regional Pricing Monitor (Apify Actor)

A private Apify Actor designed to monitor official AI pricing, promotion, help-center, app-store, device-maker, and partner pages for meaningful changes.

## What it does

- Renders JavaScript-heavy pages with Playwright.
- Extracts visible page text, deal keywords, prices, percentages, and "months free" phrases.
- Stores a hash of each page in an Apify Key-Value Store.
- First run creates a baseline (silent by default).
- Later runs output only changed pages that contain deal/pricing signals.
- Pushes structured findings to the default Dataset.
- Optionally POSTs findings to an n8n webhook.

## Recommended first deployment

Keep the Actor private while testing.

1. In Apify Console, go to **Development -> My Actors -> Create new**.
2. Choose a **Playwright + Chrome / JavaScript** Actor template, or deploy this repository from GitHub.
3. Replace the generated files with this project's files.
4. Build the Actor.
5. Run it once with `includeBaseline=false` to establish a baseline.
6. Run it a second time after adding or editing one monitored URL to verify change detection.
7. Create an Apify Schedule after the first successful run.

Apify schedules can run Actors automatically and support cron-style schedules. For your use case, start with once or twice daily rather than hourly to conserve credits.

## Suggested schedule

- 8:15 AM America/New_York daily
- Optional second run at 5:15 PM America/New_York

## n8n integration

Create an n8n Webhook node and paste its production URL into `webhookUrl`. The Actor will POST only when it has meaningful findings.

Payload shape:

```json
{
  "source": "apify-ai-deal-monitor",
  "runId": "...",
  "count": 1,
  "findings": [
    {
      "domain": "example.com",
      "url": "https://example.com/pricing",
      "changed": true,
      "matchedKeywords": ["discount"],
      "priceSnippets": ["50% off"],
      "excerpt": "..."
    }
  ]
}
```

## Important design choice

This Actor detects *changes and deal signals*; it does not decide whether a deal is trustworthy or worthwhile. Route findings to ChatGPT/Gemini/your Notion research workflow for verification before acting.

## Cost control

Playwright is more expensive than plain HTTP crawling but is much more reliable for modern pricing pages. Keep the monitored URL list focused and schedule 1-2 runs per day initially.
