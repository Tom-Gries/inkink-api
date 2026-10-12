import { ObjectId, type WithId } from 'mongodb'
import { getDb } from '../../db.js'
import type {
  FeelingDto,
  FeelingInput,
  FeelingMood,
} from '../../schemas/feeling.js'

/**
 * Ein Gefühls-Eintrag pro Dokument, verknüpft über die Better-Auth-`userId`.
 * Die userId stammt immer aus der Session – nie aus dem Request-Body.
 */
interface FeelingDocument {
  _id?: ObjectId
  userId: string
  mood: FeelingMood
  note: string
  createdAt: Date
}

const feelings = () => getDb().collection<FeelingDocument>('feelings')

function toDto(document: WithId<FeelingDocument>): FeelingDto {
  return {
    id: document._id.toHexString(),
    mood: document.mood,
    note: document.note,
    createdAt: document.createdAt.toISOString(),
  }
}

/**
 * Legt bei Bedarf den Index (userId, createdAt) an (idempotent) – so bleiben
 * die Listen-Abfragen pro Nutzer effizient, ohne separates Setup-Skript.
 */
async function ensureIndexes(): Promise<void> {
  await feelings().createIndex({ userId: 1, createdAt: -1 })
}

export async function createFeeling(
  userId: string,
  input: FeelingInput,
): Promise<FeelingDto> {
  await ensureIndexes()

  const createdAt = new Date()
  const { insertedId } = await feelings().insertOne({
    userId,
    mood: input.mood,
    note: input.note,
    createdAt,
  })

  return {
    id: insertedId.toHexString(),
    mood: input.mood,
    note: input.note,
    createdAt: createdAt.toISOString(),
  }
}

/** Liefert die eigenen Einträge, neueste zuerst. */
export async function listFeelings(
  userId: string,
  limit = 50,
): Promise<FeelingDto[]> {
  await ensureIndexes()

  const documents = await feelings()
    .find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray()

  return documents.map(toDto)
}

/** Löscht einen eigenen Eintrag (nur wenn er diesem Nutzer gehört). */
export async function deleteFeeling(
  userId: string,
  id: string,
): Promise<boolean> {
  const { deletedCount } = await feelings().deleteOne({
    _id: new ObjectId(id),
    userId,
  })

  return deletedCount > 0
}
