import { type Auth, createAuth } from './better-auth.js'
import { getTrustedOrigins } from './config.js'
import { getDb, getMongoClient } from './db.js'

let auth: Auth | undefined

/**
 * Lazy Singleton der Better-Auth-Instanz (eine DB-Verbindung pro warmem
 * Serverless-Storage).
 *
 * Die vertrauten Origins – die Origins, die Better Auth zusätzlich zur
 * eigenen baseURL für Origin-/callbackURL-Prüfungen akzeptiert – kommen
 * aus der Env-Variable `TRUSTED_ORIGINS` (komma-separiert, siehe
 * getTrustedOrigins() in config.ts). Damit lassen sich die Origins je
 * Umgebung (Development/Staging/Production) konfigurieren, ohne den
 * Code zu ändern.
 */
export function getAuth(): Auth {
  if (!auth) {
    const baseURL =
      process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'

    const secret = process.env.BETTER_AUTH_SECRET ?? ''

    const googleClientId = process.env.GOOGLE_CLIENT_ID
    const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET

    const logLevel = process.env.AUTH_LOG_LEVEL as
      | 'debug'
      | 'info'
      | 'warn'
      | 'error'
      | undefined

    // Vertraute Origins aus der Env-Variable TRUSTED_ORIGINS
    // (komma-separiert) – keine hartcodierten Domains. Ohne Einträge
    // vertraut Better Auth automatisch nur der eigenen baseURL.
    const trustedOrigins = getTrustedOrigins()

    console.log(
      '[auth:server] getAuth(): Erstelle Better-Auth-Instanz (lazy Singleton)',
    )

    console.log(
      `[auth:server] getAuth(): BETTER_AUTH_URL=${baseURL}`,
    )

    console.log(
      `[auth:server] getAuth(): BETTER_AUTH_SECRET=${secret ? `gesetzt (${secret.length} Zeichen)` : 'FEHLT'
      }`,
    )

    console.log(
      `[auth:server] getAuth(): GOOGLE_CLIENT_ID=${googleClientId ? 'gesetzt' : 'FEHLT'
      }`,
    )

    console.log(
      `[auth:server] getAuth(): GOOGLE_CLIENT_SECRET=${googleClientSecret ? 'gesetzt' : 'FEHLT'
      }`,
    )

    console.log(
      `[auth:server] getAuth(): AUTH_LOG_LEVEL=${logLevel ?? '(Standard laut NODE_ENV)'
      }`,
    )

    console.log(
      `[auth:server] getAuth(): trustedOrigins=${trustedOrigins.join(', ')}`,
    )

    if (!secret) {
      console.warn(
        '[auth:server] getAuth(): BETTER_AUTH_SECRET ist nicht gesetzt – Auth wird fehlschlagen!',
      )
    }

    if (!googleClientId || !googleClientSecret) {
      console.warn(
        '[auth:server] getAuth(): Google-Credentials fehlen – Google-Login wird nicht funktionieren!',
      )
    }

    auth = createAuth({
      db: getDb(),
      mongoClient: getMongoClient(),
      baseURL,
      secret,
      googleClientId,
      googleClientSecret,
      logLevel,
      trustedOrigins,
    })
  }

  return auth
}