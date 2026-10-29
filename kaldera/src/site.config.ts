// Site configuration. Values marked PLACEHOLDER must be replaced by the owner
// before launch. index.html reads these at build time through vite.config.ts,
// and main.ts applies them at runtime, so this file is the single source.
export const site = {
  name: 'Kaldera Analytics',
  tagline: 'Growth is an infrastructure problem.',
  description:
    'Kaldera Analytics is a marketing and revenue systems studio in Boise, Idaho. Demand, acquisition, conversion, automation, data and revenue operations designed as one connected structure.',

  // PLACEHOLDER: the production domain once registered on Cloudflare Registrar.
  domain: 'kaldera.example',
  // PLACEHOLDER: derived from the domain above, used for canonical and Open Graph URLs.
  url: 'https://kaldera.example',
  // PLACEHOLDER: the studio contact address.
  email: 'hello@kaldera.example',
  // PLACEHOLDER: the principal's portfolio.
  portfolioUrl: 'https://portfolio.example',

  location: 'Boise, Idaho',
  coordinates: '43.61° N 116.20° W',
  engagements: 'Open for 2026'
} as const;

export type SiteConfig = typeof site;
