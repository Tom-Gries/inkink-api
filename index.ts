import app from './src/index.js'

/**
 * Vercel-Function (Fluid Compute, Node.js-Runtime).
 *
 * `vercel.json` rewrited `/api/(.*)` auf `/api`; die Function erhält dabei
 * den ORIGINAL-Pfad (z. B. `/api/stacks/abc`), sodass Hono über
 * `basePath('/api')` exakt wie lokal routet. Der Default-Export (Hono-App)
 * wird von Vercel als Request-Handler erkannt (Web-Standard-Request →
 * Response, inkl. Streaming für SSE).
 */
export default app
