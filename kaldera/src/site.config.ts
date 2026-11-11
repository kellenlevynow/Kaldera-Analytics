// Site configuration. index.html reads these at build time through
// vite.config.ts and main.ts applies them at runtime, so this file is the
// single place to edit the domain and contact address.
export const site = {
  name: 'Kaldera Analytics',
  tagline: 'Marketing you can run a business on.',
  description:
    'Kaldera Analytics, Boise, Idaho. Marketing and revenue systems that help companies attract the right customers, convert more of them and make revenue repeatable.',

  // Production domain, registered on Cloudflare Registrar.
  domain: 'kaldera-analytics.com',
  // Canonical origin, no trailing slash. Used for the canonical link and Open Graph URLs.
  url: 'https://kaldera-analytics.com',
  // Studio contact address.
  email: 'hello@kaldera-analytics.com',

  // The wine page at /wine: wineries, vineyards, estates, wine bars, storage, private vaults, tour operators.
  wine: {
    path: '/wine',
    description:
      'A search through several thousand bottles of wine, ending on one. Kaldera Analytics is a marketing and revenue practice for wine estates and the trade around them: growers, merchants, wine bars, storage and private cellars, and wine country hospitality.'
  },

  location: 'Boise, Idaho',
  coordinates: '43.61° N 116.20° W',
  engagements: 'Open for 2027'
} as const;

export type SiteConfig = typeof site;
