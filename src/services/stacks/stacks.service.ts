import { ObjectId, type WithId } from 'mongodb'
import { getDb } from '../../db'
import type {
  LeaderboardEntry,
  Question,
  StackDto,
  StackInput,
} from '../../schemas/stack'

interface StackDocument {
  _id?: ObjectId
  name: string
  creatorName: string
  examTime: number
  passingScore?: number
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

export async function getStackRaw(
  id: string,
): Promise<WithId<StackDocument> | null> {
  return stacks().findOne({ _id: new ObjectId(id) })
}

export async function getStack(id: string): Promise<StackDto | null> {
  const document = await getStackRaw(id)
  return document ? toDto(document) : null
}

export async function listStacks(): Promise<StackDto[]> {
  const documents = await stacks().find().sort({ name: 1 }).toArray()
  return documents.map(toDto)
}

export async function createStack(input: StackInput): Promise<StackDto> {
  const { insertedId } = await stacks().insertOne({
    name: input.name,
    creatorName: input.creatorName,
    examTime: input.examTime,
    passingScore: input.passingScore,
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
  input: StackInput,
): Promise<StackDto | null> {
  const { modifiedCount } = await stacks().updateOne(
    { _id: new ObjectId(id) },
    {
      $set: {
        name: input.name,
        creatorName: input.creatorName,
        examTime: input.examTime,
        passingScore: input.passingScore,
        questions: input.questions,
      },
    },
  )

  return modifiedCount > 0 ? getStack(id) : null
}

export async function archiveStack(id: string): Promise<boolean> {
  const { modifiedCount } = await stacks().updateOne(
    { _id: new ObjectId(id) },
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

  return modifiedCount > 0 ? getStack(id) : toDto(document)
}
