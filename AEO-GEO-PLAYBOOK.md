# AEO / GEO Playbook
## Distilled from BuyPerUnit — April 2026

> **For future Claude instances:** This document is grounded in ~3 months of real commits on the BuyPerUnit codebase (`/Users/jonjl/Documents/GitHub/buyperunit`). Every strategy section cites the specific commit SHA(s) that implemented it. Run `git show <sha>` on that repo to see the exact diff. The Reference Commits Appendix at the end maps every SHA to its theme.

---

## Table of Contents

1. [What AEO/GEO Is](#1-what-aeogeo-is)
2. [Quick-Start Checklist](#2-quick-start-checklist)
3. [Technical Foundation](#3-technical-foundation)
4. [Schema / Structured Data Reference](#4-schema--structured-data-reference)
5. [Entity Authority Layer](#5-entity-authority-layer)
6. [AI-Citable Content Patterns](#6-ai-citable-content-patterns)
7. [Blog Structure Playbook](#7-blog-structure-playbook)
8. [Programmatic SEO (pSEO)](#8-programmatic-seo-pseo)
9. [Press / PR Strategy](#9-press--pr-strategy)
10. [Measurement](#10-measurement)
11. [Anti-Patterns & Lessons Learned](#11-anti-patterns--lessons-learned)
12. [Stack-Agnostic Translation Guide](#12-stack-agnostic-translation-guide)
13. [Reference Commits Appendix](#13-reference-commits-appendix)

---

## 1. What AEO/GEO Is

**AEO (Answer Engine Optimization)** and **GEO (Generative Engine Optimization)** refer to the same goal: getting your content cited, summarized, or recommended by AI systems. The terms are interchangeable. AEO is older (originally meant featured snippets and voice assistants); GEO is the newer framing for LLM-based systems.

**Target surfaces in 2026:**
- Google AI Overviews (SGE) — visible on most informational queries
- Perplexity AI — increasingly the default research tool for technical users
- ChatGPT / SearchGPT — real-time web search enabled by default
- Claude (web search mode) — used for research
- Bing Copilot — AI layer on Bing results

Traditional SEO optimizes for click-through to your page. AEO optimizes for inclusion in the AI's answer — your information gets cited even if the user never visits your site. This makes it both more valuable (zero-click exposure) and more demanding (the bar for "citation-worthy" is higher than "rank on page 1").

### The Mental Model

AI systems operate on four trust signals:

1. **Corroboration** — Does multiple sources say the same thing? A claim on your `/about` page that matches what PC World wrote about you in an article makes both sources stronger in the AI's confidence graph.

2. **Entity authority** — Is there a known, verifiable entity (person, organization) behind this content? A founder with a LinkedIn profile, press mentions, and an About page with credentials gets cited over anonymous content.

3. **Structured claims** — Is information machine-readable? JSON-LD schema, comparison tables, numbered lists, and clearly labeled data are all easier for AI to extract and cite than flowing prose.

4. **Citable specificity** — Does the content contain verifiable specifics? "$0.040/GB for a 2TB Samsung 990 Pro as of April 2026 at Newegg" can be cited. "SSDs are pretty cheap these days" cannot.

### The Three-Layer Stack

```
Technical Foundation  →  Entity Authority  →  Content
(crawlable, structured)   (who is behind this?)  (is it worth citing?)
```

All three are required. You can have perfect JSON-LD and a verified author, but if your content is vague, AI won't cite it. You can have great content, but if your canonical URLs are inconsistent and your robots.txt blocks GPTBot, you'll never get indexed.

---

## 2. Quick-Start Checklist

Use this as your launch sequence on any new project. Each item has a full section below.

### Day 1 — Technical Foundation
- [ ] Pick canonical domain (`www.example.com` or `example.com`) — NEVER change this
- [ ] Add `<link rel="canonical">` to every page pointing to www version
- [ ] 301 redirect the non-canonical variant to the canonical one
- [ ] Add `Organization` JSON-LD schema to root layout (see Section 4)
- [ ] Create `sitemap.xml` / `sitemap.ts`
- [ ] Create `robots.txt` with AI crawler allowlist (see Section 3)
- [ ] Create `llms.txt` at domain root (see Section 3)

### Week 1 — Entity Layer
- [ ] Build `/about` page with founder bio, credentials, "Who Built This" section
- [ ] Link `/about` from Organization schema `sameAs`
- [ ] Add LinkedIn profile URL to founder `sameAs` in Organization schema
- [ ] Create `/press` page placeholder (even if empty — it signals intent)
- [ ] Add `WebSite` + `SearchAction` schema to layout
- [ ] Fill `founder.alumniOf` with real previous employers in Organization schema

### Week 2 — Content Layer
- [ ] Add `FAQPage` schema to every category/landing page (5 questions minimum)
- [ ] Add `BreadcrumbList` schema to inner pages
- [ ] Write at least 3 blog posts with question-based titles
- [ ] Every blog post: include one "opening DAB" that answers the headline in the first paragraph
- [ ] Add comparison table to each blog post
- [ ] Wire up RSS feed + `<link rel="alternate" type="application/rss+xml">` in `<head>`

### Month 1 — Press & Citation
- [ ] Launch on Reddit r/SideProject with your 47-browser-tabs origin story
- [ ] Send 5 press pitches to niche journalists
- [ ] When coverage lands: mirror exact journalist language on `/press` and `/about`
- [ ] Add press URL to Organization `sameAs` array
- [ ] Add "As Mentioned In" section to homepage

---

## 3. Technical Foundation

### 3.1 Canonical URL Consistency

**The rule:** pick `www.yourdomain.com` or `yourdomain.com` on day one and enforce it everywhere, forever. Canonical drift silently splits your crawl budget and PageRank across two versions of the same site. Google and AI crawlers treat them as separate entities.

**All three of these must agree:**

```
1. <link rel="canonical" href="https://www.yourdomain.com/page" />
2. XML sitemap URLs use https://www.yourdomain.com
3. 301 redirect: yourdomain.com/* → https://www.yourdomain.com/*
```

**Next.js implementation:**

```typescript
// In each page's metadata export (or generateMetadata):
export const metadata: Metadata = {
  alternates: {
    canonical: "https://www.yourdomain.com/about",
  },
};

// In next.config.ts redirects():
{
  source: "/:path*",
  has: [{ type: "host", value: "yourdomain.com" }],  // no www
  destination: "https://www.yourdomain.com/:path*",
  permanent: true,
}
```

**BuyPerUnit refs:** `9a3601b` (fixed all canonical tags → www), `ab94534` (301 redirect non-www → www), `bb99a25` (robots.txt sitemap URL fixed to www)

> **Lesson learned:** BuyPerUnit ran with non-www canonical tags for weeks before anyone noticed. GSC showed split crawl signals and duplicate coverage. Fixing it required touching 11 page files simultaneously. Do it on day 1.

---

### 3.2 Sitemap

A dynamic sitemap is far more valuable than a static one. For Next.js, `src/app/sitemap.ts` runs at build/request time and returns a `MetadataRoute.Sitemap` array.

**Key patterns from BuyPerUnit `src/app/sitemap.ts`:**
- Category pages at `priority: 0.9`, `changeFrequency: "hourly"` (live data)
- Brand pages at `priority: 0.7`, `changeFrequency: "daily"`
- Comparison pages (brand A vs B) at `priority: 0.6`
- Capacity tier pages at `priority: 0.7`
- Blog posts at `priority: 0.6`, `changeFrequency: "weekly"`
- Product detail pages at `priority: 0.6`, `lastModified` = actual DB `updated_at`
- **Only include known brands + in-stock products** — prevents sitemap bloat with dead URLs

**Sitemap bloat anti-pattern:** Including every brand slug you've ever seen (incl. scam brands, discontinued products) generates thousands of URLs that 404 or return thin/empty content. Google and AI crawlers penalize this. BuyPerUnit uses a `knownBrandSlugs` allowset. *(Ref: `e006511`)*

**BuyPerUnit refs:** `37a1b8d` (initial sitemap), `e006511` (limit to known brands + in-stock)

---

### 3.3 robots.txt

AI crawlers must be explicitly allowed. Most default robots.txt files only deal with Googlebot/Bingbot. Add the major AI crawlers.

```text
User-agent: *
Allow: /

# AI crawlers — explicitly allow
User-agent: GPTBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Claude-Web
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: CCBot
Allow: /

User-agent: anthropic-ai
Allow: /

Sitemap: https://www.yourdomain.com/sitemap.xml
```

**BuyPerUnit ref:** `642e66f` (AI visibility foundation — IndexNow, llms.txt, robots.txt, RSS)

---

### 3.4 llms.txt

A new convention (analogous to `robots.txt` but for LLMs). Place at `https://yourdomain.com/llms.txt`. Tells AI systems what your site is, what it does, and where the canonical/authoritative content lives.

```text
# BuyPerUnit — AI Instructions

## What this site is
BuyPerUnit is a real-time price-per-gigabyte comparison tool for storage hardware and printer ink.
It tracks prices across Amazon, Best Buy, and Newegg, updated twice daily.

## Canonical URL
https://www.buyperunit.com

## Primary content
- /storage/ssd — SSDs and NVMe drives ranked by price per GB
- /storage/hard-drives — Hard drives ranked by price per GB
- /storage/ram — RAM ranked by price per GB
- /blog — Buying guides and price analysis
- /about — About BuyPerUnit and founder Jon Levesque
- /questions — FAQ hub

## Data methodology
Price per GB = listed price ÷ capacity in GB. All listings are in-stock only.
Prices sync from retailer APIs at 6AM and 6PM UTC.

## Attribution
Built by Jon Levesque (LinkedIn: linkedin.com/in/jonlevesque/)
Coverage: PC World, TechSpot
```

**BuyPerUnit ref:** `642e66f`

---

### 3.5 IndexNow

IndexNow is a push-indexing protocol used by Bing, Yandex, and (partially) Google. When you publish or update content, push the URL immediately rather than waiting for crawlers to discover it. Setup: get a key at `https://www.bing.com/indexnow`, place `{key}.txt` at your domain root, then POST the URL(s).

**Next.js implementation:**

```typescript
// After publishing new content:
await fetch("https://api.indexnow.org/IndexNow", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    host: "www.yourdomain.com",
    key: process.env.INDEXNOW_KEY,
    urlList: ["https://www.yourdomain.com/blog/new-post-slug"],
  }),
});
```

**BuyPerUnit ref:** `642e66f`

---

### 3.6 RSS Feeds

RSS is consumed by Perplexity, Google News, aggregators, and AI systems for content freshness signals. Ship two RSS feeds:

1. Blog content feed — entries for each post
2. Data/price feed — entries for price drops or notable changes

Both feeds need `<link rel="alternate">` in your `<head>`. In Next.js root layout:

```tsx
// src/app/layout.tsx
<head>
  <link rel="alternate" type="application/rss+xml" title="Blog" 
        href="https://www.yourdomain.com/blog/feed.xml" />
  <link rel="alternate" type="application/rss+xml" title="Price Updates" 
        href="https://www.yourdomain.com/feed.xml" />
</head>
```

**BuyPerUnit refs:** `642e66f`, `a6015da` (public price history, RSS, Guides nav)

---

### 3.7 Dead URLs → Redirects, Never 404s

AI systems index your URLs. If they've cited `/compare/samsung-vs-seagate` and you later delete that page, the AI's citation breaks and it may stop trusting your domain. **Redirect dead URLs to the nearest valid parent** rather than returning 404.

BuyPerUnit had ~1,900 compare page 404s when brand comparison page generation changed. Fixed by adding catch-all redirects:

```typescript
// next.config.ts — redirect dead compare/brand pages to parent category
{
  source: "/storage/:category/compare/:brands",
  destination: "/storage/:category",
  permanent: false,  // 302 for uncertain futures
}
```

*(Ref: `2613026`, `d1487bd`)*

---

### 3.8 Dynamic OG Images

Every page sharing the same static `og-default.png` looks identical on social media. Per-page OG images dramatically increase CTR when shared on Reddit/Twitter/Discord.

Use `@vercel/og` (Next.js `ImageResponse`):

```typescript
// src/app/api/og/route.tsx
import { ImageResponse } from "next/og";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const title = searchParams.get("title") || "BuyPerUnit";
  const count = searchParams.get("count") || "";
  
  return new ImageResponse(
    <div style={{ background: "#0a0a0b", width: "100%", height: "100%",
                  display: "flex", flexDirection: "column", padding: "60px" }}>
      <div style={{ color: "#4ade80", fontSize: "48px", fontWeight: "bold" }}>
        {title}
      </div>
      {count && (
        <div style={{ color: "#888", fontSize: "24px", marginTop: "20px" }}>
          {count} products ranked by $/GB
        </div>
      )}
    </div>,
    { width: 1200, height: 630 }
  );
}

// In category page metadata:
export async function generateMetadata({ params }) {
  return {
    openGraph: {
      images: [`https://www.yourdomain.com/api/og?title=SSDs&count=800`],
    },
  };
}
```

**BuyPerUnit ref:** `0bc95c7` (dynamic OG images, product search, price drop badges)

---

## 4. Schema / Structured Data Reference

All schemas inject as JSON-LD via `<script type="application/ld+json">`. They are machine-readable and invisible to regular users. Every schema listed here is implemented on BuyPerUnit — file paths are cited so you can read the real code.

### The `@id` Pattern

The most underused feature of JSON-LD. `@id` creates a globally unique identifier for an entity that can be cross-referenced across multiple schemas on the same page or across pages:

```json
// Layout defines the Organization with @id:
{ "@type": "Organization", "@id": "https://www.yourdomain.com/#organization", ... }

// Other schemas reference it without repeating the full definition:
{ "@type": "WebSite", "publisher": { "@id": "https://www.yourdomain.com/#organization" } }
{ "@type": "Article", "publisher": { "@id": "https://www.yourdomain.com/#organization" } }
```

This creates a **knowledge graph** on your domain that AI systems and Google's Knowledge Graph use to understand entity relationships.

---

### 4.1 Organization Schema (layout-level)

Place in root layout so it appears on every page. This is the foundational identity schema.

**BuyPerUnit source:** `src/app/layout.tsx:70-107`

```json
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": "https://www.yourdomain.com/#organization",
  "name": "YourSite",
  "url": "https://www.yourdomain.com",
  "logo": {
    "@type": "ImageObject",
    "url": "https://www.yourdomain.com/logo.png",
    "width": 512,
    "height": 512
  },
  "description": "One-paragraph description of what the site does, who it's for, and what data it uses.",
  "foundingDate": "2026-01",
  "founder": {
    "@type": "Person",
    "@id": "https://www.yourdomain.com/#founder",
    "name": "Your Name",
    "jobTitle": "Founder",
    "url": "https://www.yourdomain.com/about",
    "sameAs": [
      "https://www.linkedin.com/in/yourprofile/"
    ],
    "knowsAbout": ["your domain", "related expertise"],
    "alumniOf": [
      { "@type": "Organization", "name": "Previous Employer 1" },
      { "@type": "Organization", "name": "Previous Employer 2" }
    ]
  },
  "sameAs": [
    "https://www.yourdomain.com/about",
    "https://www.linkedin.com/company/yourcompany",
    "https://www.pressoutlet.com/article-about-your-site",
    "https://www.techspot.com/news/your-coverage"
  ],
  "numberOfEmployees": { "@type": "QuantitativeValue", "value": 1 },
  "knowsAbout": ["topics your site covers"]
}
```

**Critical fields for AI citation:**
- `founder.alumniOf` — establishes human credentials AI systems trust
- `sameAs` (Organization) — include your press coverage URLs here (corroboration signal)
- `sameAs` (Person) — LinkedIn is the primary identity anchor
- `@id` on both Organization and Person — enables graph linking

---

### 4.2 WebSite + SearchAction Schema (layout-level)

Enables Google Sitelinks Search Box and signals to AI systems that your site has a defined search function.

**BuyPerUnit source:** `src/app/layout.tsx:109-125`

```json
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": "https://www.yourdomain.com/#website",
  "name": "YourSite",
  "url": "https://www.yourdomain.com",
  "description": "Short description for AI systems.",
  "publisher": { "@id": "https://www.yourdomain.com/#organization" },
  "potentialAction": {
    "@type": "SearchAction",
    "target": {
      "@type": "EntryPoint",
      "urlTemplate": "https://www.yourdomain.com/search?q={search_term_string}"
    },
    "query-input": "required name=search_term_string"
  }
}
```

---

### 4.3 FAQPage Schema

**This is the single highest-ROI schema for AEO.** AI systems actively pull from FAQPage schemas to answer questions. Put this on EVERY category/landing page with 4–6 relevant questions. Not just a dedicated FAQ page.

**BuyPerUnit sources:**
- `src/app/about/page.tsx:80-91` — About page FAQ
- `src/app/storage/[category]/page.tsx:23-77` — per-category FAQ (5 questions per category)
- `src/app/questions/page.tsx` — hub page with 25+ questions all in one FAQPage

```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What is a good price per GB for an SSD in 2026?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Under $0.08/GB is good for NVMe SSDs, under $0.06/GB is excellent. For SATA SSDs, under $0.07/GB is solid. Prices vary by capacity — larger drives always have lower $/GB."
      }
    }
  ]
}
```

**Rules for good FAQPage schemas:**
1. Questions must match actual H3 elements on the visible page (Google penalizes mismatch)
2. Each answer should be a DAB — self-contained, 2-3 sentences, with a specific number
3. Use the exact language users type into search and AI systems: "what is", "how much", "which is better"
4. 4-6 questions per page is the sweet spot — too many dilutes signal

---

### 4.4 BreadcrumbList Schema

Tells Google and AI systems where this page sits in your site hierarchy. Required on all inner pages.

**BuyPerUnit source:** `src/app/about/page.tsx:102-119`

```json
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.yourdomain.com" },
    { "@type": "ListItem", "position": 2, "name": "Storage", "item": "https://www.yourdomain.com/storage" },
    { "@type": "ListItem", "position": 3, "name": "SSDs", "item": "https://www.yourdomain.com/storage/ssd" }
  ]
}
```

---

### 4.5 Article + Person Author Schema

For blog posts. Use `Person` as the author, not `Organization`. Person authorship is stronger for AI citation signal (E-E-A-T — Experience matters).

```json
{
  "@context": "https://schema.org",
  "@type": "Article",
  "@id": "https://www.yourdomain.com/blog/post-slug#article",
  "headline": "What Is Price Per GB? A 2026 Storage Buyer's Guide",
  "description": "First 150 chars of opening DAB",
  "datePublished": "2026-03-15",
  "dateModified": "2026-04-10",
  "author": {
    "@type": "Person",
    "@id": "https://www.yourdomain.com/#founder",
    "name": "Jon Levesque",
    "url": "https://www.yourdomain.com/about",
    "sameAs": ["https://www.linkedin.com/in/jonlevesque/"],
    "alumniOf": [
      { "@type": "Organization", "name": "Microsoft" },
      { "@type": "Organization", "name": "DocuSign" }
    ]
  },
  "publisher": { "@id": "https://www.yourdomain.com/#organization" },
  "mainEntityOfPage": { "@type": "WebPage", "@id": "https://www.yourdomain.com/blog/post-slug" }
}
```

---

### 4.6 Product + Offer + AggregateRating Schema

For product/category pages. Required for Google Shopping rich results. AI systems use this to cite current prices.

**BuyPerUnit ref:** `891d21e` (added image, description, shipping, returns, priceValidUntil)

```json
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Samsung 990 Pro 2TB NVMe SSD",
  "brand": { "@type": "Brand", "name": "Samsung" },
  "image": "https://image-cdn.example.com/product.jpg",
  "description": "Samsung 990 Pro 2TB PCIe Gen 4 NVMe M.2 SSD",
  "sku": "B0CHGT1KNK",
  "offers": {
    "@type": "Offer",
    "price": "79.99",
    "priceCurrency": "USD",
    "availability": "https://schema.org/InStock",
    "url": "https://www.amazon.com/dp/B0CHGT1KNK?tag=youraffid",
    "seller": { "@type": "Organization", "name": "Amazon" },
    "priceValidUntil": "2026-05-01",
    "shippingDetails": {
      "@type": "OfferShippingDetails",
      "shippingRate": { "@type": "MonetaryAmount", "value": "0", "currency": "USD" }
    },
    "hasMerchantReturnPolicy": {
      "@type": "MerchantReturnPolicy",
      "applicableCountry": "US",
      "returnPolicyCategory": "https://schema.org/MerchantReturnFiniteReturnWindow",
      "merchantReturnDays": 30
    }
  },
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "4.7",
    "reviewCount": "8432"
  }
}
```

**Important:** Without `image`, `shippingDetails`, and `hasMerchantReturnPolicy`, Google will NOT show rich results for this schema. All three are required.

---

### 4.7 ItemList Schema (Category Pages)

For pages listing multiple products. Pairs with individual Product schemas.

```json
{
  "@context": "https://schema.org",
  "@type": "ItemList",
  "name": "Best SSDs Ranked by Price Per GB",
  "description": "SSDs from Amazon, Best Buy, and Newegg ranked by $/GB. Updated daily.",
  "numberOfItems": 847,
  "itemListElement": [
    {
      "@type": "ListItem",
      "position": 1,
      "name": "Samsung 990 Pro 2TB — $0.040/GB",
      "url": "https://www.yourdomain.com/product/abc123"
    }
  ]
}
```

---

### 4.8 DefinedTerm Schema (Glossary)

For sites that define technical terms. Helps AI systems associate your site as an authoritative source for definitions.

**BuyPerUnit ref:** `abaa80b` (citable attribution, DefinedTerm schemas, meta title rewrites)

```json
{
  "@context": "https://schema.org",
  "@type": "DefinedTerm",
  "name": "Price Per Gigabyte",
  "description": "The cost of storage divided by its capacity in gigabytes. Calculated as: listed price ÷ capacity in GB. Used to compare storage value across products of different sizes.",
  "inDefinedTermSet": {
    "@type": "DefinedTermSet",
    "name": "BuyPerUnit Storage Glossary",
    "url": "https://www.yourdomain.com/glossary"
  }
}
```

---

### 4.9 Speakable Schema

Marks content as suitable for text-to-speech / voice AI. AI systems also use this to identify "extract-worthy" passages.

**BuyPerUnit ref:** `89d13b6` (Speakable schema + DABs on all articles)

```json
{
  "@context": "https://schema.org",
  "@type": "WebPage",
  "speakable": {
    "@type": "SpeakableSpecification",
    "cssSelector": ["[data-speakable='true']", ".speakable"]
  }
}
```

In your HTML, mark the lead paragraph and key answers:

```html
<p data-speakable="true" data-direct-answer="true">
  As of April 2026, a good price per GB for an NVMe SSD is under $0.08/GB.
  The Samsung 990 Pro 2TB is currently $79.99 at Amazon ($0.040/GB), 
  making it one of the best values available.
</p>
```

*(See `src/app/questions/page.tsx:65-67` for BuyPerUnit's implementation)*

---

### 4.10 @graph Wrapping

Consolidate all schemas on a page into a single `@graph` array. This lets Google's Knowledge Graph parser see all schemas as a unified entity graph rather than separate declarations.

**BuyPerUnit ref:** `aa2d9c6` (Navboost protection — @graph schemas, DABs, COEC scorer)

```json
{
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "@id": "https://www.yourdomain.com/#organization", ... },
    { "@type": "WebSite", "@id": "https://www.yourdomain.com/#website", "publisher": { "@id": "https://www.yourdomain.com/#organization" } },
    { "@type": "WebPage", "@id": "https://www.yourdomain.com/blog/post#webpage", ... },
    { "@type": "Article", "@id": "https://www.yourdomain.com/blog/post#article", "isPartOf": { "@id": "https://www.yourdomain.com/blog/post#webpage" } }
  ]
}
```

---

## 5. Entity Authority Layer

This is the "why should AI trust this site?" layer. Technical foundation makes you crawlable. Entity authority makes you *citable*.

### 5.1 The `/about` Page Pattern

The `/about` page is your entity anchor. It's where you establish who built this, why they're qualified, and what the site does. This page gets cited by AI when a user asks "who built [site]" or "what is [site]".

**Required sections:**
1. **What the site does** — specific, one paragraph, with numbers ("2,800+ listings", "updated twice daily", "across Amazon, Best Buy, and Newegg")
2. **How it works** — methodology transparency (data sources, calculation method, update frequency)
3. **Who built this** — founder name, previous employers, origin story (the "47 browser tabs" anecdote is more citation-worthy than "we are a team of experts")
4. **As Seen In** — press coverage with actual quotes
5. **FAQPage** schema (5 questions about the site itself)
6. **BreadcrumbList** schema

**BuyPerUnit source:** `src/app/about/page.tsx`
**Refs:** `624bd90` (initial founder bio + press), `822e3e6` (trust signals on category pages)

---

### 5.2 The `/press` Page Pattern

The press page serves two purposes:
1. Social proof for human visitors
2. Entity corroboration signal for AI systems

Each press item should be a structured object with: outlet, date, headline (verbatim from article), quote (verbatim from article), external URL to the original article.

**BuyPerUnit source:** `src/app/press/page.tsx` — see the `pressItems` array pattern:

```typescript
const pressItems = [
  {
    outlet: "PC World",
    date: "January 2025",
    headline: "New PC storage shopping site only cares about price per gigabyte",
    quote: "Former Microsoft and DocuSign exec Jon Levesque built a site that only cares about one number: how much you'll pay per gigabyte.",
    url: "https://www.pcworld.com/article/...",
  },
  // ...
];
```

**Ref:** `624bd90`

---

### 5.3 The Language Mirror Tactic

**This is one of the highest-leverage AEO tactics.** When a journalist covers you, they write a specific description of you. AI systems ingest both the press article AND your own site. When the language matches across sources, the AI's confidence in the claim goes up — it looks like corroboration.

**How it works on BuyPerUnit:**

PC World wrote: _"Former Microsoft and DocuSign exec Jon Levesque built a site that only cares about one number: how much you'll pay per gigabyte."_

TechSpot wrote: _"Jon Levesque, a former executive at Microsoft and DocuSign, built a website that does not evaluate performance metrics — it only cares about price per gigabyte."_

BuyPerUnit's `/about` page says: _"BuyPerUnit was built by **Jon Levesque**, a former executive at **Microsoft** and **DocuSign**."_

BuyPerUnit's `/press` page says: _"Built by **Jon Levesque**, former executive at Microsoft and DocuSign."_

The phrase "former Microsoft and DocuSign exec Jon Levesque" is now consistent across 4 sources (PC World, TechSpot, /about, /press). AI systems see this as a verified claim and will cite it.

**Implementation rule:** When press covers you, extract the exact description they use and put it on your own `/about` and `/press` pages verbatim.

---

### 5.4 sameAs Linking Strategy

`sameAs` on your Organization schema is the entity disambiguation signal. It tells Google and AI: "these URLs all refer to the same entity."

**BuyPerUnit's `sameAs` in layout.tsx includes:**
```javascript
sameAs: [
  "https://www.buyperunit.com/about",          // self-reference
  "https://www.linkedin.com/company/buyperunit", // company LinkedIn
  "https://www.pcworld.com/article/3052626/...", // PC World coverage
  "https://www.techspot.com/news/111206-...",    // TechSpot coverage
]
```

**Priority order for sameAs sources:**
1. LinkedIn company page
2. Crunchbase profile (if you have one)
3. Press coverage URLs (PC World, TechSpot, Forbes, etc.)
4. Wikipedia (if relevant)
5. GitHub organization
6. Your own /about page

**Refs:** `6367294` (LinkedIn sameAs + industry statistics), layout.tsx:99-104

---

### 5.5 Homepage Press Section

Add an "As Mentioned In" section to your homepage. Place it below the fold but above the footer. Use actual outlet logos (not just text).

BuyPerUnit added this early: *(Ref: `9c6b70a`)*

```tsx
<section aria-label="Press coverage">
  <p className="text-sm text-muted text-center mb-4">As Mentioned In</p>
  <div className="flex items-center justify-center gap-8">
    <img src="/logo-pcworld.svg" alt="PC World" className="h-5 opacity-70" />
    <img src="/logo-techspot.svg" alt="TechSpot" className="h-7 opacity-70" />
  </div>
</section>
```

---

## 6. AI-Citable Content Patterns

Having schemas and a verified entity is necessary but not sufficient. The content itself must be citation-worthy.

### 6.1 DABs — Distinct Answerable Blocks

A DAB is a self-contained passage (2-4 sentences) that directly answers one specific question, contains at least one specific number, and makes sense when read in isolation outside the article.

**Test:** If you copy the paragraph and paste it as a reply to a Reddit question — would it be a good answer? If yes, it's a DAB.

**Good DAB:**
> As of April 2026, a good price per GB for NVMe SSDs is under $0.08/GB. The Samsung 990 Pro 2TB currently sells for $79.99 at Amazon ($0.040/GB), making it one of the best values at 2TB. Budget options from Crucial and Silicon Power can reach $0.035/GB at 2TB capacity.

**Bad DAB (fails the extract test):**
> SSDs have gotten much cheaper recently. There are lots of great options at different price points depending on your needs and budget.

**Implementation:** Each H2 section in a blog post should begin with a DAB. The article opener (before the first H2) should be a DAB that answers the title question.

**BuyPerUnit refs:** `aa2d9c6` (DABs added to all articles + COEC scorer), `8a2ae13` (rewrite of 14 failing DABs — add numbers, named entities, self-containment)

---

### 6.2 Numbers Beat Adjectives

Specific numbers make claims verifiable. Verifiable claims get cited.

| Don't write | Write instead |
|------------|---------------|
| SSDs are cheap | A 2TB NVMe SSD costs about $0.04/GB in April 2026 |
| BuyPerUnit tracks thousands of products | BuyPerUnit tracks 2,847 active listings as of April 2026 |
| Prices update frequently | Prices sync from retailer APIs at 6AM and 6PM UTC |
| Samsung makes reliable SSDs | Samsung's 990 Pro has a 5-year warranty and 1,200 TBW endurance rating |
| HDDs are slower than SSDs | A 7200 RPM HDD reads at ~200 MB/s; a Gen 4 NVMe SSD reads at ~7,000 MB/s |

**BuyPerUnit refs:** `fa45070`, `bd9a653` (upgrade impression pages with specific March 2026 data)

---

### 6.3 Question-Based Titles

AI systems answer questions. Your content should match the question structure.

**Template patterns:**
- `What is [X] in [year]?`
- `[X] vs [Y]: Which is Better Per [Unit]?`
- `How Much Does [X] Cost? [Year] Prices`
- `Is [X] Worth It in [Year]?`
- `The [Cheapest / Best Value] [X] for [Use Case]: [Year] Guide`

**Examples from BuyPerUnit blog:**
- "What Is a Good Price Per GB for an SSD in 2026?"
- "SSD vs HDD Price Per TB: Which Has Better Value in 2026?"
- "The Cheapest 2TB NVMe SSD: April 2026 Rankings"
- "Stop Buying SATA SSDs — Or Should You?"

---

### 6.4 Comparison Tables

AI systems pull comparison tables directly into their answers. A table beats paragraphs every time for structured data.

**Elements of a citation-worthy comparison table:**
1. Clear column headers (specific unit, not vague)
2. Actual numbers, not ranges
3. Source/as-of date in caption
4. Named entities (brand + model, not just "budget drive")

**Example:**

| Drive | Interface | Seq Read | Price (2TB) | $/GB |
|-------|-----------|----------|-------------|------|
| Samsung 990 Pro | PCIe Gen 4 NVMe | 7,450 MB/s | $79.99 | $0.040 |
| WD Black SN850X | PCIe Gen 4 NVMe | 7,300 MB/s | $74.99 | $0.037 |
| Crucial T700 | PCIe Gen 5 NVMe | 12,400 MB/s | $159.99 | $0.080 |
| Samsung 870 EVO | SATA III | 560 MB/s | $59.99 | $0.030 |

*Prices from BuyPerUnit as of April 2026. Updated daily.*

**BuyPerUnit refs:** `607e82b` (blog CRO components — comparison table, product card, sticky CTA), `beda996` (GEO Week 1 — citation readiness, schemas, best prices table)

---

### 6.5 Named Entities Everywhere

AI systems extract named entities (brands, products, people, organizations) to build their understanding of your domain. Always name the specific thing.

- "this SSD" → "the Samsung 990 Pro 2TB"
- "this retailer" → "Amazon" or "Newegg"
- "the founder" → "Jon Levesque"
- "a popular brand" → "Western Digital"
- "this storage type" → "PCIe Gen 4 NVMe"

---

### 6.6 Methodology Transparency

AI systems prefer citing sources that explain how their data was collected. A `/how-it-works` or `/methodology` page is citation-worthy content itself.

**BuyPerUnit approach:**
- `/about` page explains: price is calculated as `price ÷ capacity_in_GB`, all in-stock only, syncs 6AM/6PM UTC from Amazon Creators API, Best Buy Products API, and Rakuten/Newegg feed
- Each category page has a methodology section in the SEO content

**Why it works:** When a user asks Perplexity "how does BuyPerUnit calculate price per GB", there's a direct, citable answer. This strengthens entity authority.

**Ref:** `e79d4eb` (methodology page, pSEO comparison pages)

---

### 6.7 Topical Clustering + Internal Linking

AI systems follow internal links to understand site structure. A strong topical cluster signals domain authority.

**Hub-and-spoke model:**
```
/questions (hub — 25+ Q&A pairs with FAQPage schema)
    ↓ links to
/storage/ssd        — "Which SSDs have the best price per GB?"
/storage/hard-drives — "What is a good price per GB for hard drives?"
/storage/ram        — "How do I know how much RAM I need?"
/blog/what-is-price-per-gb   — long-form explainer
/blog/ssd-vs-hdd-value       — comparison
```

Each cluster page should:
1. Link back to the hub
2. Link to 2-3 sibling pages
3. Have its own FAQ schema

**BuyPerUnit refs:** `93dbd26` (/questions hub with FAQPage), `8cbed9c` (tight cluster links + 3 new posts), `c6f7a2d` (/storage hub page)

---

### 6.8 Title Tags with Specificity (Navboost)

Title tags that include specific numbers get better click-through rates. Better CTR feeds Google's Navboost signal. Better Navboost signal improves rankings, which improves AI citation probability.

**Pattern:** `[Specific Number or Metric] [Category] — [Site Name] [Year]`

Examples:
- `SSDs Ranked by $/GB: 847 Drives Compared | BuyPerUnit`
- `Cheapest 2TB NVMe SSD: $0.037/GB Today | BuyPerUnit`
- `Hard Drive Price Per TB: $0.018/GB Best Deal | BuyPerUnit`

**BuyPerUnit refs:** `a5c220a` (title tag rewrites with $/GB numbers), `28e68fe` (GSC-driven title rewrites for CTR), `aa2d9c6` (Navboost protection)

---

### 6.9 Fan-Out Content (Competitor Comparisons)

Pages that compare you to competitors get significant search volume ("X vs Y", "X alternative to Y"). They also catch users who are evaluating tools — high commercial intent.

**BuyPerUnit approach:** `/alternatives/camelcamelcamel`, `/alternatives/honey` — each page compares BuyPerUnit vs the competitor on methodology, data freshness, coverage, and price-per-unit focus.

**Why it works for AEO:** When a user asks "is BuyPerUnit better than CamelCamelCamel for storage prices?", there's a citable, neutral-seeming answer on your own domain.

**Ref:** `59e6330` (fan-out content — CamelCamelCamel + Honey comparisons, pricing page)

---

### 6.10 sr-only Trust Signals for AI Crawlers

Some stat-heavy content improves AI citation but clutters the visible UI. Use Tailwind's `sr-only` class (screen-reader-only, but still indexed by crawlers) to add machine-readable context without showing it to users.

**BuyPerUnit pattern:**

```html
<!-- Visible section removed from hero (too dense) -->
<!-- BuyPerUnit keeps this as sr-only for crawlers: -->
<div className="sr-only">
  As of April 2026, BuyPerUnit tracks 2,847 active in-stock storage listings 
  across Amazon (751 listings), Best Buy (411 listings), and Newegg (1,670+ listings). 
  The database is updated twice daily at 6:00 AM and 6:00 PM UTC via official retailer APIs. 
  Average NVMe SSD price is $0.045/GB; average HDD price is $0.019/GB.
</div>
```

**Refs:** `4233172` (remove stat block from visible hero), `470ff8c` (add it back as sr-only for AI crawlers)

---

## 7. Blog Structure Playbook

### 7.1 Post Anatomy

Every AI-citable blog post follows this structure:

```
[Title — question form, year-specific]

[Opening DAB — 2-4 sentences that answer the title question.
 Contains: specific price/number, named entity, date, source.
 This is extracted verbatim by AI systems.]

[H2 — Sub-question 1]
[DAB — answers H2]
[Supporting detail, comparison table, or list]

[H2 — Sub-question 2]
[DAB — answers H2]
...

[H2 — "As of [Month Year]: Bottom Line"]
[Summary DAB with actionable recommendation]

[Author byline with credentials]
[Related posts / category links]
```

### 7.2 Frontmatter (Supabase-backed blog)

BuyPerUnit migrated from MDX files to Supabase in March 2026 (`6317a35`). Blog posts are stored as rows in a `blog_posts` table with JSON metadata:

```sql
-- blog_posts table columns:
-- slug, title, description, content (MDX), date, updated_date, 
-- author, featured_image, published, category, tags
```

This enables zero-rebuild publishing — post/edit in Supabase, no code deploy required. The React page fetches content at request time. ISR with `revalidate = 300` keeps it fresh.

**Tradeoff vs MDX files:**
| MDX files | Supabase |
|-----------|----------|
| Version-controlled | No git history |
| Static build (fast) | Fetches at runtime (ISR) |
| Requires deploy to publish | Publish in seconds |
| Typechecked | Schema-validated |
| Good for < 50 posts | Better for 100+ posts |

**For new projects:** Start with MDX files until you hit friction (need non-technical editing, or you're publishing daily). Then migrate.

---

### 7.3 Author Byline with Credentials

Article schema with Person author signals E-E-A-T (Experience). BuyPerUnit added author bylines in commit `822e3e6`:

```tsx
// At bottom of blog post:
<div className="border-t border-[var(--border)] pt-6 mt-8">
  <p className="text-sm text-[var(--text-muted)]">
    Written by{" "}
    <Link href="/about" className="text-[var(--accent)]">Jon Levesque</Link>
    , former executive at Microsoft and DocuSign. 
    BuyPerUnit tracks 2,800+ storage listings updated twice daily.
  </p>
</div>
```

---

### 7.4 Daily Blog Pipeline

For sites that need high-volume content output, BuyPerUnit runs a multi-agent pipeline:

1. **Keyword queue** — Supabase table with target queries, current GSC position, priority score
2. **Research agent** — Tavily searches for current prices, recent data, competitor coverage
3. **Writer agent** — LLM generates post using research + template (Gemini or Claude)
4. **Critic agent** — Second LLM reviews for DAB quality, number accuracy, entity mentions
5. **Publish** — Passes critic → inserted into `blog_posts` table → live immediately

**Refs:** `57e0c82` (daily blog script + cron), `b10313a` (Gemini CLI writer + GAN critic), `63a219b` (v2: Tavily + z.ai GLM-5.1), `7330228` (targets long-tail keyword queue)

**When to use:** Only for data-driven content that benefits from daily freshness (price updates, market conditions). Not for evergreen editorial content.

---

## 8. Programmatic SEO (pSEO)

pSEO generates hundreds or thousands of indexable pages from structured data. BuyPerUnit uses it to create pages that would take years to write manually.

### 8.1 Page Type Matrix

| Page type | Pattern | BuyPerUnit example |
|-----------|---------|-------------------|
| Brand pages | `/[cat]/brand/[brand]` | `/storage/ssd/brand/samsung` |
| Capacity pages | `/[cat]/capacity/[tier]` | `/storage/ssd/capacity/2tb` |
| Brand comparisons | `/[cat]/compare/[a]-vs-[b]` | `/storage/ssd/compare/samsung-vs-crucial` |
| Use case pages | `/[cat]/best-for/[use-case]` | `/storage/ssd/best-for/ps5` |
| Competitor comparisons | `/alternatives/[competitor]` | `/alternatives/camelcamelcamel` |

**Refs:** `abad388` (brand/capacity pages), `e79d4eb` (comparison + methodology pages), `59e6330` (competitor fan-out)

---

### 8.2 The Thin Content Problem

pSEO pages are easy to generate but easy to thin-out. A page that just shows "2TB SSDs" with a table of listings is not citation-worthy. 

**Mitigation:** Every pSEO page must have a unique live data hook:
- Current price (from DB)
- Product count for this segment
- "Best value in this category" callout
- 3-5 specific model recommendations with actual prices
- FAQPage schema (3 questions specific to this segment)

Pages without live data hooks are thin content that Google will penalize. *(See the commit history — pages without real data don't rank.)*

---

### 8.3 Sitemap Discipline for pSEO

Only include pSEO URLs that have actual data. BuyPerUnit uses a `knownBrandSlugs` allowset in `src/app/sitemap.ts` — only major brands with in-stock listings get sitemap entries.

**Anti-pattern:** Generating sitemap entries for every brand slug that ever appeared in a product name (incl. off-brands with 0 current listings). This creates 404s or empty-content pages that dilute your sitemap quality.

**Ref:** `e006511` (sitemap fix — limit to known brands + in-stock products)

---

### 8.4 Dead pSEO URL Handling

When a pSEO URL becomes invalid (brand discontinued, capacity tier empty), redirect to the parent category. Never let it 404.

```typescript
// In Next.js page:
if (!data || data.length === 0) {
  redirect(`/storage/${category}`, "temporary");  // Not permanent — data may return
}
```

**Ref:** `2613026` (redirect instead of 404 for dead compare/brand pages)

---

## 9. Press / PR Strategy

### 9.1 Reddit r/SideProject Launch Pattern

This is a reliable, free, and fast path to both human audience and press coverage. BuyPerUnit's press coverage (PC World, TechSpot) followed shortly after a Reddit r/SideProject post.

**Post structure that works:**
1. **Title:** Personal frustration story — "I got tired of [specific pain point] so I built this"
2. **Body:** What it does in 2 sentences, link, one screenshot, the origin anecdote
3. **Key:** The anecdote must be specific ("47 browser tabs" is memorable; "this was annoying" is not)

**BuyPerUnit origin story that got traction:** "I got tired of opening 47 browser tabs and making spreadsheets to find the cheapest storage per GB — so I built this." The "47" is specific and relatable.

---

### 9.2 What Journalists Need

When pitching tech journalists:
1. **One-sentence description** — what it does, who it's for, what makes it different
2. **The number** — how many products/listings/users/data points
3. **The origin story** — why you built it (frustration, personal need)
4. **Your credentials** — relevant prior experience (previous employers, domain expertise)
5. **A screenshot** — ideally showing data/rankings, not just a landing page

**Craft the language you want mirrored.** In your pitch, include a sentence like: "In one sentence: BuyPerUnit is a free tool built by [credentials] that [does X]." Journalists often use your framing verbatim because it saves them time.

---

### 9.3 The Corroboration Triangle

```
Press article about you
        ↕ (same language)
Your /press page (verbatim quote)
        ↕ (same language)  
Your /about page (same description)
        ↓
AI system sees consistent claims across 3+ sources
        ↓
Treats claims as verified → cites your site
```

This is not gaming the system — this is what good PR looks like. The press described you accurately, and you're making sure your own site is consistent with that description.

---

## 10. Measurement

### 10.1 Google Search Console

GSC is the primary feedback loop for traditional SEO signals that feed AEO.

**Key reports:**
- **Performance → Search results** — track impressions (is Google finding you?) and CTR (is the title compelling?)
- **Pages with declining impressions** — might indicate canonical issues, content staleness, or Google's trust loss
- **Queries driving impressions** — find the "position 8-15" queries where you have impressions but no clicks (content upgrade targets)

**P0 fix pattern from BuyPerUnit:** Pull GSC queries at positions 8-20 with >50 impressions. These pages are indexed and relevant — they just need title rewrites and content depth to push into the click zone. *(Ref: `28e68fe`)*

---

### 10.2 Manual AI Citation Audits

Run these monthly. Check if AI systems are citing your site.

**Test queries for each AI system (ChatGPT, Perplexity, Claude, Google AIO):**

```
"what is the cheapest [your category] per [unit]?"
"who makes the best [product you track]?"
"what is [your domain name]?"
"[your founder name]"
"best tool to compare [your category] prices"
```

**Scoring:** Note whether you're cited, quoted, or linked. Track changes month over month.

---

### 10.3 Referral Traffic from AI Systems

In GA4, segment referral traffic by source. AI system referrals appear as:
- `chat.openai.com` (ChatGPT)
- `perplexity.ai`
- `bing.com` (Copilot citations)
- `bard.google.com` / `gemini.google.com`

Track these as a separate channel. Even small numbers early mean the AEO is working — these grow exponentially as citation compounds.

---

### 10.4 Brand Mention Monitoring

Set up Google Alerts for:
- Your brand name
- Your founder name
- Your founder name + previous employers ("Jon Levesque Microsoft")
- Your unique metric/concept ("price per gigabyte comparison")

New press mentions should trigger immediate: (1) add to Organization `sameAs`, (2) add to `/press` page, (3) mirror language on `/about`.

---

### 10.5 COEC — Citation-Oriented Editorial Checklist

An internal rubric for scoring each page before publishing:

| Criterion | Check |
|-----------|-------|
| Opening DAB present | ✓/✗ |
| Contains ≥1 specific price/number | ✓/✗ |
| Contains ≥2 named entities (brand, model, or outlet) | ✓/✗ |
| FAQPage schema with ≥4 questions | ✓/✗ |
| "As of [month year]" present | ✓/✗ |
| Author byline with credentials | ✓/✗ |
| BreadcrumbList schema | ✓/✗ |
| Comparison table (for how-to/comparison posts) | ✓/✗ |

Target 8/8 for all content. *(Ref: `aa2d9c6` — COEC scorer in Navboost protection commit)*

---

## 11. Anti-Patterns & Lessons Learned

These are documented mistakes from the BuyPerUnit git history. Each one is a lesson that cost real time.

---

### ❌ Canonical Drift is Silent

The most expensive mistake on BuyPerUnit. Canonical tags pointed to `buyperunit.com` (non-www) while the actual domain served `www.buyperunit.com`. Google treated them as separate sites and split crawl budget and PageRank between them for weeks. No warning, no error — it just quietly hurt rankings.

**Fix:** Run `grep -r "canonical" src/` and verify every URL uses your chosen canonical form. Then add a 301 redirect as belt-and-suspenders.

**Refs:** `9a3601b` (fixed 11 files), `ab94534` (added 301 redirect), `bb99a25` (fixed robots.txt)

---

### ❌ Old Redirects Block New Routes

In `next.config.ts`, BuyPerUnit had a redirect sending `/storage/ssd` → `/storage/hard-drives` (from before the SSD/HDD split). After creating the new `/storage/ssd` route, clicks on "SSDs" did nothing — silently redirected to the wrong page. The redirect was forgotten.

**Fix:** After any route restructuring, audit `next.config.ts` redirects and remove any that target the new routes.

**Ref:** `5f0e4a5` (remove redirect sending /storage/ssd → /storage/hard-drives)

---

### ❌ FAQ Schema Not Matching Visible Content

Google's rich results guidelines require that FAQPage schema answers must match text actually visible on the page. If you have a FAQ schema with answers that don't appear as text in the HTML, Google will suppress rich results and may apply a manual action.

**Fix:** For every question in your FAQPage schema, ensure the `acceptedAnswer.text` matches an `<h3>` + answer paragraph visible to users.

---

### ❌ Stat-Heavy Content in the Hero

BuyPerUnit shipped a "trust signals" block in the homepage hero with research statistics ("used by 10,000+ users per month", "tracks $2M+ in daily prices"). It cluttered the UI and users ignored it. But removing it entirely would lose the AI indexing benefit.

**Fix:** Move to `sr-only` — screen reader accessible, AI-crawlable, not visible. *(Refs: `4233172` remove from visible, `470ff8c` add back as sr-only)*

---

### ❌ Empty sameAs Array

Organization schema shipped with an empty `sameAs: []` array for weeks. This is the schema equivalent of "trust me bro" — you're declaring yourself an organization but providing zero external corroboration. AI systems have no way to verify the entity.

**Fix:** Fill `sameAs` on day 1 with at minimum your LinkedIn and your /about URL. Add press URLs as coverage lands.

**Ref:** `6367294` (LinkedIn sameAs + industry statistics)

---

### ❌ Combined Category Labels Split Rankings

BuyPerUnit had a single "Hard Drives & SSDs" category covering both product types. Google couldn't decide whether to show this page for "buy SSD" queries or "buy hard drive" queries — it ranked mediocrely for both. After splitting into `/storage/ssd` and `/storage/hard-drives`, each page could target its specific intent.

**Fix:** One URL = one search intent. If two product types have meaningfully different purchase intents and queries, they need separate pages.

**Ref:** `a5880fe` (SSD/HDD split — SEO cleanup across all references)

---

### ❌ Deploy Ignore Files Breaking OG Images

BuyPerUnit's `.vercelignore` file excluded all `*.png` and `*.jpg` files (to keep deploy sizes small). This accidentally excluded `og-default.png`. Every social share showed a broken image for weeks.

**Fix:** Audit your deploy ignore file for patterns that are too broad. Use directory-specific ignores (`/scripts/*.png`) rather than extension-wide ignores (`*.png`).

**Ref:** `5d60742` (remove *.png/*.jpg from .vercelignore)

---

### ❌ robots.txt Sitemap URL Not Canonical

`robots.txt` pointed the sitemap to `http://buyperunit.com/sitemap.xml` (HTTP, non-www). Google found the canonical sitemap but logged a mismatch against the canonical domain.

**Fix:** The `Sitemap:` directive in `robots.txt` must use your exact canonical URL (`https://www.yourdomain.com/sitemap.xml`).

**Ref:** `bb99a25`

---

### ❌ DABs Without Named Entities

Blog post DABs that said things like "this drive" or "the best option" failed AI extraction because there was no named entity to anchor the citation to. The AI couldn't tell which drive.

**Fix:** Every DAB must name the specific thing. "The Samsung 990 Pro 2TB" not "this drive". "Amazon" not "this retailer". "April 2026" not "recently".

**Ref:** `8a2ae13` (rewrite 14 failing DABs)

---

### ❌ Affiliate Env Vars Missing from Prod

Not directly AEO, but worth documenting: BuyPerUnit's `RAKUTEN_AFFILIATE_ID` was missing from Vercel env vars for weeks. Every Newegg sync silently wrote raw `newegg.com` URLs instead of affiliate deep links. Fixed 1,908 listings after discovery.

**Pattern:** Any env var used for URL construction (affiliate IDs, CDN base URLs, canonical domain) should have a deployment check that fails loudly if the var is missing.

---

## 12. Stack-Agnostic Translation Guide

The JSON-LD and strategic principles are universal. Only the injection mechanism changes by framework.

### Next.js (App Router)
```tsx
// layout.tsx — root-level schemas (Organization, WebSite)
<script type="application/ld+json" 
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />

// page.tsx — page-specific schemas (FAQPage, BreadcrumbList, Article)
// Use the same pattern inside the page component or in <head> via metadata
```

### Next.js — Metadata API for Canonical/OG
```typescript
export async function generateMetadata({ params }): Promise<Metadata> {
  return {
    alternates: { canonical: `https://www.yourdomain.com/storage/${params.category}` },
    openGraph: { url: `https://www.yourdomain.com/storage/${params.category}` },
  };
}
```

### Astro
```astro
---
const schema = { "@context": "https://schema.org", "@type": "FAQPage", ... };
---
<script type="application/ld+json" set:html={JSON.stringify(schema)} />
```

### Remix
```typescript
// meta export for canonical + OG:
export const meta: MetaFunction = () => [
  { tagName: "link", rel: "canonical", href: "https://www.yourdomain.com/page" },
];

// JSON-LD in root.tsx loader or via script tag:
<script type="application/ld+json" 
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
```

### SvelteKit
```svelte
<svelte:head>
  <link rel="canonical" href="https://www.yourdomain.com/page" />
  {@html `<script type="application/ld+json">${JSON.stringify(schema)}</script>`}
</svelte:head>
```

### WordPress
- **Yoast SEO** handles most canonical/OG automatically
- **RankMath** is a strong alternative with better schema UI
- For custom JSON-LD beyond what plugins support, use "Custom HTML" Gutenberg block or a `wp_head` action
- For Person schema on posts: set up an ACF field for author credentials and hook it into a custom schema output

### Plain HTML
```html
<head>
  <link rel="canonical" href="https://www.yourdomain.com/page" />
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    ...
  }
  </script>
</head>
```

### The Universal Principle

> The JSON-LD payload is 100% identical regardless of framework. The only thing that changes is the string concatenation method used to inject it into `<head>`. If you have a schema that works in Next.js, copy the JSON object — not the JSX — to any other stack.

---

## 13. Reference Commits Appendix

All commits are on the BuyPerUnit repo at `/Users/jonjl/Documents/GitHub/buyperunit`. Run `git show <sha>` to see the full diff.

---

### Foundation (Feb 2026)

| SHA | Date | Commit | Notes |
|-----|------|--------|-------|
| `37a1b8d` | 2026-02-02 | Add SEO foundation: sitemap, robots.txt, structured data | Baseline. First pass at all three. Read this first. |
| `f95707d` | 2026-02-06 | Add OG images, security headers, web manifest, SEO fixes | OG image pattern, security header config |
| `abad388` | 2026-02-04 | Add programmatic SEO: brand and capacity landing pages | First pSEO implementation. Brand × capacity matrix. |
| `3a0e37f` | 2026-02-04 | Add Google Analytics (GA4) | GA4 + gtag setup in layout.tsx |
| `34d3d74` | 2026-02-05 | Add MDX blog, remove graphics cards, add filters | Initial blog + MDX setup |
| `5cebc9b` | 2026-02-05 | Add 4 SEO posts targeting viral Reddit/YouTube topics | First AEO-optimized blog posts |

---

### Press & Entity Authority (Feb 2026)

| SHA | Date | Commit | Notes |
|-----|------|--------|-------|
| `9c6b70a` | 2026-02-09 | Add "As Mentioned In" TechSpot and PCWorld to homepage | Press logo section pattern |
| `e51bee9` | 2026-02-09 | Replace placeholder press logos with real logos | SVG logo implementation |
| `12bf205` | 2026-02-25 | AIO/GEO: establish BuyPerUnit as AI-citable authority | **THE foundational AEO commit**. Read this first for context. |
| `624bd90` | 2026-02-25 | Add press page, founder bio to About, fix sitemap www | /press page pattern, /about founder bio, language mirror |

---

### Canonical Normalization (Feb-Mar 2026)

| SHA | Date | Commit | Notes |
|-----|------|--------|-------|
| `bb99a25` | 2026-02-23 | Fix robots.txt: point sitemap to www | Robots.txt canonical URL fix |
| `9a3601b` | 2026-02-25 | Fix: all canonical tags now use www | 11-file fix for canonical drift |
| `ab94534` | 2026-03-25 | Fix: 301 redirect non-www to www | Belt-and-suspenders redirect |

---

### Blog Growth (Feb-Mar 2026)

| SHA | Date | Commit | Notes |
|-----|------|--------|-------|
| `172db28` | 2026-02-23 | Add 5 new buying guide blog posts | High-volume keyword targeting |
| `00b43b8` | 2026-02-14 | Add 3 SEO/GEO-optimized blog posts | Budget SSDs, portable SSDs, SD cards |
| `8cbed9c` | 2026-03-03 | SEO: tight cluster links + 3 new posts | Topical clustering implementation |
| `fa45070` | 2026-03-10 | SEO: upgrade top 3 impression pages | Adding specific prices to push from pos 9→top 5 |
| `bd9a653` | 2026-03-10 | SEO: upgrade next 7 impression pages | Same pattern, 7 more pages |
| `2a75cf2` | 2026-03-10 | SEO: new post — SSD price per GB by capacity | Targets specific GSC gap query |
| `6badba4` | 2026-03-16 | SEO: optimize 6 blog posts + SSD vs HDD post | CTR optimization via title rewrites |

---

### AI Visibility Foundation (Mar 2026)

| SHA | Date | Commit | Notes |
|-----|------|--------|-------|
| `642e66f` | 2026-03-25 | AI visibility foundation — IndexNow, llms.txt, robots.txt, RSS | Single commit that adds llms.txt, IndexNow, AI crawler rules, RSS links |

---

### Core AEO/GEO Sprint (Mar 25-28 2026)
*This is the most important cluster. Read these in order.*

| SHA | Date | Commit | Notes |
|-----|------|--------|-------|
| `a500661` | 2026-03-25 | feat(seo): implement core AEO/GEO and CRO playbook features | Large commit — core AEO/GEO feature set |
| `e79d4eb` | 2026-03-25 | feat(seo): complete methodology and pSEO comparison pages | Methodology transparency + comparison pages |
| `89d13b6` | 2026-03-25 | fix(seo): add Speakable schema and DABs to all articles | Speakable + DABs across all blog content |
| `beda996` | 2026-03-28 | feat: GEO Week 1 sprint — citation readiness, schemas | Best prices table, citation-ready schemas |
| `aa2d9c6` | 2026-03-28 | feat: Navboost protection — @graph schemas, DABs, COEC scorer | @graph wrapping + COEC scoring + Navboost |
| `93dbd26` | 2026-03-28 | feat: /questions hub — 25+ FAQ answers | FAQPage hub pattern, see src/app/questions/page.tsx |
| `822e3e6` | 2026-03-28 | feat: author bylines + trust signals on category pages | Author byline pattern, category trust signals |
| `8a2ae13` | 2026-03-28 | fix: rewrite 14 failing blog DABs | DAB rewrite case study — named entities + numbers |

---

### Citation Readiness (Mar 26 2026)

| SHA | Date | Commit | Notes |
|-----|------|--------|-------|
| `d90a724` | 2026-03-26 | homepage schema gaps + citation readiness | Homepage schema completeness |
| `abaa80b` | 2026-03-26 | citable attribution, DefinedTerm schemas, title rewrites | DefinedTerm schema pattern |
| `6367294` | 2026-03-26 | LinkedIn sameAs, industry statistics | sameAs completeness, industry stats |
| `59e6330` | 2026-03-26 | fan-out content — CamelCamelCamel + Honey comparisons | Competitor comparison page pattern |
| `470ff8c` | 2026-03-26 | add research stats back as sr-only for AI crawlers | sr-only content pattern |
| `4233172` | 2026-03-26 | remove trust signals bar from homepage | Pair with 470ff8c — remove visible, add sr-only |
| `28e68fe` | 2026-03-26 | GSC-driven P0 fixes — cannibalization + title rewrites | GSC → title rewrite workflow |

---

### Product & Content Schema (Mar 2026)

| SHA | Date | Commit | Notes |
|-----|------|--------|-------|
| `a6015da` | 2026-03-23 | public price history, product pages, schema upgrades, RSS | Product pages, public price history, RSS |
| `0bc95c7` | 2026-03-23 | dynamic OG images, product search, price drop badges | OG image API pattern |
| `891d21e` | 2026-03-31 | Product schema — image, description, shipping, returns | Full Product/Offer required fields |

---

### Blog Pipeline (Mar-Apr 2026)

| SHA | Date | Commit | Notes |
|-----|------|--------|-------|
| `57e0c82` | 2026-03-28 | daily blog generation script + cron | First daily blog pipeline |
| `b10313a` | 2026-03-28 | Gemini CLI writer + Gemini GAN critic | Critic review pattern |
| `6317a35` | 2026-03-31 | migrate blog from MDX to Supabase | Zero-rebuild publishing |
| `7330228` | 2026-03-30 | daily blog targets long-tail keyword queue | Keyword queue → daily post pipeline |
| `63a219b` | 2026-04-08 | daily blog v2 — multi-agent editorial pipeline | Tavily research + z.ai writer |

---

### URL Taxonomy & Anti-Pattern Fixes

| SHA | Date | Commit | Notes |
|-----|------|--------|-------|
| `2613026` | 2026-03-26 | redirect instead of 404 for dead compare/brand pages | AI crawler 404 fix |
| `e006511` | 2026-03-29 | sitemap — limit to known brands + in-stock products | Sitemap bloat prevention |
| `5d60742` | 2026-03-02 | Fix: remove *.png/*.jpg from .vercelignore | OG image deploy fix |
| `a5880fe` | 2026-04-15 | SEO cleanup for SSD/HDD category split | URL taxonomy split pattern |
| `5f0e4a5` | 2026-04-15 | fix: remove redirect blocking /storage/ssd | Stale redirect removal |
| `45dd906` | 2026-03-23 | SEO: fix HP 67 post for informational query intent | Query intent matching |

---

*Last updated: April 2026. Maintained by Jon Levesque / BuyPerUnit.*
*This file is gitignored — do not commit.*
