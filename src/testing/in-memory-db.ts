import { ObjectId } from 'mongodb'

type FakeDocument = { _id: ObjectId } & Record<string, unknown>

/** Einfacher Gleichheits-Filter (Key -> Wert); unterstützt auch `_id`. */
type Filter = Record<string, unknown>

function matches(document: FakeDocument, filter: Filter): boolean {
  return Object.entries(filter).every(([key, value]) => {
    const actual = document[key]
    if (key === '_id' && value instanceof ObjectId) {
      return actual instanceof ObjectId && actual.equals(value)
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
        find() {
          // Selbst-verkettender Cursor: sort()/limit() sind optional und
          // in beliebiger Reihenfolge nutzbar (wie beim echten Treiber).
          const cursor = {
            sort: () => cursor,
            limit: () => cursor,
            async toArray() {
              return documents.map((document) => ({ ...document }))
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
      }
    },
  }
}
