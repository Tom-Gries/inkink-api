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
   * Better-Auth-`userId` des Erstellers – nur bei angemeldetem Anlegen.
   * Anonyme und ältere Stacks (vor dem Sichtbarkeits-Feature) haben
   * dieses Feld nicht.
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
 *
 * Ohne gültige Session (`userId` fehlt) sind ausschließlich öffentliche
 * Stacks sichtbar. Ein `$or`-Zweig mit leerer `userId` würde fehlende
 * `userId`-Felder (anonym/legacy) fälschlich als eigenen Besitz matchen
 * und private Stacks leaken – deshalb wird er dann weggelassen.
 */
function visibleStacksFilter(userId?: string): Filter<StackDocument> {
  if (!userId) {
    return { isPublic: { $ne: false } }
  }

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
  userId?: string,
): Promise<StackDto | null> {
  const document = await stacks().findOne({
    _id: new ObjectId(id),
    ...visibleStacksFilter(userId),
  })
  return document ? toDto(document) : null
}

/** Liefert öffentliche Stacks und (bei Session) die privaten des Nutzers. */
export async function listStacks(userId?: string): Promise<StackDto[]> {
  const documents = await stacks()
    .find(visibleStacksFilter(userId))
    .sort({ name: 1 })
    .toArray()
  return documents.map(toDto)
}

/**
 * Erstellt einen Stack. Ohne gültige Session (anonym) wird `isPublic`
 * serverseitig auf `true` erzwungen – privat stellen ist nur
 * angemeldeten Nutzern erlaubt. Anonym angelegte Stacks haben kein
 * `userId`-Feld.
 */
export async function createStack(
  userId: string | undefined,
  input: StackInput,
): Promise<StackDto> {
  const isPublic = userId ? input.isPublic : true
  const { insertedId } = await stacks().insertOne({
    ...(userId ? { userId } : {}),
    name: input.name,
    creatorName: input.creatorName,
    examTime: input.examTime,
    passingScore: input.passingScore,
    isPublic,
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
    isPublic,
    archived: false,
    questions: input.questions,
    leaderboard: [],
  }
}

/**
 * Speichert einen Stack neu. Fragen werden vollständig ersetzt
 * (§10.2: Löschungen aus dem Formular werden dauerhaft übernommen).
 *
 * Legacy-Stacks (vor der Zugriffskontrolle erstellt) sowie anonym
 * angelegte Stacks haben kein `userId`-Feld. Solche ungeclaimten,
 * öffentlichen Stacks übernimmt per atomarem Claim der erste
 * Bearbeiter – so können Besitzer alte Stacks weiterhin bearbeiten
 * und z. B. privat stellen, ohne sie zu verlieren.
 */
export async function updateStack(
  id: string,
  userId: string,
  input: StackInput,
): Promise<StackDto | null> {
  const objectId = new ObjectId(id)
  const set = {
    name: input.name,
    creatorName: input.creatorName,
    examTime: input.examTime,
    passingScore: input.passingScore,
    isPublic: input.isPublic,
    questions: input.questions,
  }

  // 1) Normalfall: Nur der Besitzer darf bearbeiten.
  const owned = await stacks().updateOne(
    { _id: objectId, userId },
    { $set: set },
  )
  if (owned.modifiedCount > 0) return getStack(id, userId)

  // 2) Claim: ungeclaimter öffentlicher Stack wird vom ersten
  //    Bearbeiter übernommen. Private Stacks Dritter sind nie
  //    übernehmbar (kein `isPublic: { $ne: false }`).
  const claimed = await stacks().updateOne(
    { _id: objectId, userId: { $exists: false }, isPublic: { $ne: false } },
    { $set: { ...set, userId } },
  )
  if (claimed.modifiedCount > 0) return getStack(id, userId)

  return null
}

/**
 * Archiviert einen Stack (nur der Besitzer). Ungeclaimte öffentliche
 * Legacy-/Anonym-Stacks werden dabei ebenfalls übernommen (Claim),
 * damit auch ältere Stacks archivierbar bleiben.
 */
export async function archiveStack(
  id: string,
  userId: string,
): Promise<boolean> {
  const objectId = new ObjectId(id)

  const owned = await stacks().updateOne(
    { _id: objectId, userId },
    { $set: { archived: true } },
  )
  if (owned.modifiedCount > 0) return true

  const claimed = await stacks().updateOne(
    { _id: objectId, userId: { $exists: false }, isPublic: { $ne: false } },
    { $set: { archived: true, userId } },
  )

  return claimed.modifiedCount > 0
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
