import { type Filter, ObjectId, type WithId } from 'mongodb'
import { getDb } from '../../db.js'
import type {
  LeaderboardEntry,
  Question,
  StackDto,
  StackInput,
} from '../../schemas/stack.js'

interface StackDocument {
  _id?: ObjectId
  /**
   * Better-Auth-`userId` des Erstellers. Ältere Stacks (vor dem
   * Sichtbarkeits-Feature) haben dieses Feld noch nicht.
   */
  userId?: string
  name: string
  creatorName: string
  examTime: number
  passingScore?: number
  isPublic: boolean
  archived: boolean
  questions: Question[]
  leaderboard: LeaderboardEntry[]
}

const stacks = () => getDb().collection<StackDocument>('stacks')

function toDto(document: WithId<StackDocument>): StackDto {
  return {
    id: document._id.toHexString(),
    name: document.name,
    creatorName: document.creatorName,
    examTime: document.examTime,
    passingScore: document.passingScore ?? 0,
    // Ältere Stacks kennen noch kein "isPublic" -> bleiben öffentlich.
    isPublic: document.isPublic ?? true,
    archived: document.archived,
    // Ältere Stacks kennen noch kein "scoring" -> Default "all".
    questions: document.questions.map((question) => ({
      ...question,
      scoring: question.scoring ?? 'all',
    })),
    leaderboard: document.leaderboard,
  }
}

/**
 * Sortiert die Top-3 nach Punktzahl (absteigend) und – bei gleicher
 * Punktzahl – nach benötigter Zeit (aufsteigend). Liefert höchstens
 * drei Einträge.
 */
export function rankLeaderboard(
  entries: LeaderboardEntry[],
): LeaderboardEntry[] {
  return [...entries]
    .sort((a, b) => {
      const byScore = b.score - a.score
      if (byScore !== 0) return byScore
      return a.time - b.time
    })
    .slice(0, 3)
}

/**
 * Match-Filter für sichtbare Stacks: Öffentliche Stacks sieht jeder
 * (inkl. älterer Stacks ohne `isPublic`-Feld), private Stacks nur der
 * Besitzer. Die `userId` stammt aus der Session – nie aus dem Body.
 */
function visibleStacksFilter(userId: string): Filter<StackDocument> {
  return {
    $or: [{ isPublic: { $ne: false } }, { userId }],
  }
}

/** Liefert einen Stack ungefiltert (nur der Leaderboard-Prozess nutzt das). */
export async function getStackRaw(
  id: string,
): Promise<WithId<StackDocument> | null> {
  return stacks().findOne({ _id: new ObjectId(id) })
}

/** Liefert einen Stack, sofern er für den Nutzer sichtbar ist. */
export async function getStack(
  id: string,
  userId: string,
): Promise<StackDto | null> {
  const document = await stacks().findOne({
    _id: new ObjectId(id),
    ...visibleStacksFilter(userId),
  })
  return document ? toDto(document) : null
}

/** Liefert öffentliche Stacks und die privaten des angemeldeten Nutzers. */
export async function listStacks(userId: string): Promise<StackDto[]> {
  const documents = await stacks()
    .find(visibleStacksFilter(userId))
    .sort({ name: 1 })
    .toArray()
  return documents.map(toDto)
}

export async function createStack(
  userId: string,
  input: StackInput,
): Promise<StackDto> {
  const { insertedId } = await stacks().insertOne({
    userId,
    name: input.name,
    creatorName: input.creatorName,
    examTime: input.examTime,
    passingScore: input.passingScore,
    isPublic: input.isPublic,
    archived: false,
    questions: input.questions,
    leaderboard: [],
  })

  return {
    id: insertedId.toHexString(),
    name: input.name,
    creatorName: input.creatorName,
    examTime: input.examTime,
    passingScore: input.passingScore,
    isPublic: input.isPublic,
    archived: false,
    questions: input.questions,
    leaderboard: [],
  }
}

/**
 * Speichert einen Stack neu. Fragen werden vollständig ersetzt
 * (§10.2: Löschungen aus dem Formular werden dauerhaft übernommen).
 */
export async function updateStack(
  id: string,
  userId: string,
  input: StackInput,
): Promise<StackDto | null> {
  const { modifiedCount } = await stacks().updateOne(
    { _id: new ObjectId(id), userId },
    {
      $set: {
        name: input.name,
        creatorName: input.creatorName,
        examTime: input.examTime,
        passingScore: input.passingScore,
        isPublic: input.isPublic,
        questions: input.questions,
      },
    },
  )

  return modifiedCount > 0 ? getStack(id, userId) : null
}

export async function archiveStack(
  id: string,
  userId: string,
): Promise<boolean> {
  const { modifiedCount } = await stacks().updateOne(
    { _id: new ObjectId(id), userId },
    { $set: { archived: true } },
  )

  return modifiedCount > 0
}

/** Fügt einen Leaderboard-Eintrag hinzu, sofern er in die Top 3 reicht. */
export async function addLeaderboardEntry(
  id: string,
  entry: LeaderboardEntry,
): Promise<StackDto | null> {
  const document = await getStackRaw(id)
  if (!document) return null

  const ranked = rankLeaderboard([...document.leaderboard, entry])
  if (
    !ranked.some(
      (item) =>
        item.name === entry.name &&
        item.score === entry.score &&
        item.time === entry.time,
    )
  ) {
    // Eintrag hat keinen Top-3-Platz erreicht – Leaderboard bleibt unverändert.
    return toDto(document)
  }

  const { modifiedCount } = await stacks().updateOne(
    { _id: new ObjectId(id) },
    { $set: { leaderboard: ranked } },
  )

  if (modifiedCount === 0) return toDto(document)

  return toDto((await getStackRaw(id)) ?? document)
}
