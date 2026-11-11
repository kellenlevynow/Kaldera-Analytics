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

  // Primary navigation, rendered into every page's header at build time by
  // vite.config.ts, which marks the current page. To add a destination, add an
  // entry here; the header lays items out in order and collapses to the menu on
  // narrow screens. Labels are plain text, hrefs are site-relative.
  navigation: [
    { label: 'Aerospace & Defense', href: '/aerospace' },
    { label: 'Wine, Estates & Collections', href: '/wine' }
  ],

  // The wine page at /wine: wineries, vineyards, estates, wine bars, storage, private vaults, tour operators.
  wine: {
    path: '/wine',
    description:
      'A search through several thousand bottles of wine, ending on one. Kaldera Analytics is a marketing and revenue practice for wine estates and the trade around them: growers, merchants, wine bars, storage and private cellars, and wine country hospitality.'
  },

  // The aerospace and defense page at /aerospace: manufacturers and specialist suppliers to the A&D industry.
  aerospace: {
    path: '/aerospace',
    description:
      'Engineered to be found. Built to be chosen. Kaldera Analytics builds the market intelligence, strategy and revenue infrastructure that connect advanced manufacturers, specialist suppliers and technology providers in aerospace and defense with the programs, primes and partners that need them.'
  },

  location: 'Boise, Idaho',
  coordinates: '43.61° N 116.20° W',
  engagements: 'Open for 2027'
} as const;

export type SiteConfig = typeof site;
