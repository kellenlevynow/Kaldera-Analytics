// Sends the project's default Pages address to the real domain with a
// permanent redirect, so the site has one public address for search engines,
// analytics and shared links. Per-deployment preview hosts
// (<hash>.kaldera-analytics.pages.dev) are left alone for testing.
const PAGES_HOST = 'kaldera-analytics.pages.dev';
const CANONICAL = 'https://kaldera-analytics.com';

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (url.hostname === PAGES_HOST) {
    return Response.redirect(CANONICAL + url.pathname + url.search, 301);
  }
  return context.next();
}
