// Site configuration. index.html reads these at build time through
// vite.config.ts and main.ts applies them at runtime, so this file is the
// single place to edit the domain, contact address and portfolio link.
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
  // The principal's portfolio.
  portfolioUrl: 'https://kellenlevynow.github.io/portfolio/',

  location: 'Boise, Idaho',
  coordinates: '43.61° N 116.20° W',
  engagements: 'Open for 2027'
} as const;

export type SiteConfig = typeof site;
