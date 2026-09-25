import { type Db, MongoClient } from 'mongodb'

let client: MongoClient | undefined

/**
 * Lazy Singleton: Erstellt den MongoClient beim ersten Zugriff und
 * wiederverwendet ihn danach. So bleibt der Handler ohne Env-Variablen
 * importierbar (z. B. in Tests) und die Verbindung wird zwischen
 * Serverless-Invocations auf Vercel wiederverwendet.
 */
export function getMongoClient(): MongoClient {
  client ??= new MongoClient(getMongoUri())

  return client
}

export function getDb(): Db {
  return getMongoClient().db(process.env.MONGODB_DB ?? 'inkink')
}

function getMongoUri(): string {
  const uri = process.env.MONGODB_URI

  if (!uri) {
    throw new Error(
      'MONGODB_URI ist nicht gesetzt. Bitte in api/.env konfigurieren.',
    )
  }

  return uri
}
