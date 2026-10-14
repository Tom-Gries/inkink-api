import { ObjectId } from 'mongodb'

type FakeDocument = { _id: ObjectId } & Record<string, unknown>

/** Filter: Gleichheit pro Key sowie `$or`/`$ne` für Sichtbarkeits-Abfragen. */
type Filter = Record<string, unknown>

function matches(document: FakeDocument, filter: Filter): boolean {
  return Object.entries(filter).every(([key, value]) => {
    const actual = document[key]

    if (key === '_id') {
      if (!(value instanceof ObjectId)) return false
      return actual instanceof ObjectId && actual.equals(value)
    }

    // $or: Dokument passt, sobald mindestens eine Teil-Bedingung passt.
    if (key === '$or' && Array.isArray(value)) {
      return value.some((part) => matches(document, part as Filter))
    }

    // Vergleichsoperatoren wie { isPublic: { $ne: false } } oder
    // { userId: { $exists: false } }.
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const operators = value as Record<string, unknown>
      if ('$ne' in operators) {
        return actual !== operators.$ne
      }
      if ('$exists' in operators) {
        return operators.$exists === true
          ? actual !== undefined
          : actual === undefined
      }
    }

    return actual === value
  })
}

function applySet(document: FakeDocument, set: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(set)) {
    document[key] = value
  }
}

/**
 * Minimaler In-Memory-Ersatz für die MongoDB – genau die Oberfläche,
 * die die Services nutzen (insertOne, find/sort/limit/toArray,
 * findOne, updateOne, deleteOne). Die API-Vertragstests laufen damit
 * ohne echte Datenbank (kein Server, keine Env-Variablen).
 */
export function createInMemoryDb() {
  const collections = new Map<string, FakeDocument[]>()

  return {
    collection(name: string) {
      const documents = collections.get(name) ?? []
      collections.set(name, documents)

      return {
        async insertOne(document: Record<string, unknown>) {
          const _id = new ObjectId()
          documents.push({ _id, ...document })

          return { insertedId: _id }
        },
        find(filter: Filter = {}) {
          // Selbst-verkettender Cursor: sort()/limit() sind optional und
          // in beliebiger Reihenfolge nutzbar (wie beim echten Treiber).
          const cursor = {
            sort: () => cursor,
            limit: () => cursor,
            async toArray() {
              return documents
                .filter((document) => matches(document, filter))
                .map((document) => ({ ...document }))
            },
          }

          return cursor
        },
        async findOne(filter: Filter) {
          const found = documents.find((d) => matches(d, filter))
          return found ? { ...found } : null
        },
        async updateOne(
          filter: Filter,
          update: { $set: Record<string, unknown> },
          _options?: { upsert?: boolean },
        ) {
          const index = documents.findIndex((d) => matches(d, filter))
          if (index === -1) return { matchedCount: 0, modifiedCount: 0 }
          applySet(documents[index], update.$set)
          return { matchedCount: 1, modifiedCount: 1 }
        },
        async deleteOne(filter: Filter) {
          const index = documents.findIndex((d) => matches(d, filter))
          if (index === -1) return { deletedCount: 0 }
          documents.splice(index, 1)
          return { deletedCount: 1 }
        },
        // Index-Erstellung ist im In-Memory-Ersatz ein No-op: Sie liefert nur
        // den Namen des (nicht real angelegten) Index zurück, damit Services
        // mit idempotentem ensureIndexes() auch ohne echte DB testbar bleiben.
        async createIndex(spec: Record<string, unknown>) {
          return Object.keys(spec).join('_')
        },
      }
    },
  }
}
