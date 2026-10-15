import { HTTPException } from 'hono/http-exception'
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

/** Zuordnung Stack → Gruppe (viele-zu-viele). */
interface StackGroupDocument {
  _id?: ObjectId
  stackId: string
  groupId: string
  addedBy: string
  addedAt: Date
}

/** Die „groups“-Collection gehört Conectink – dieses Modul liest sie nur. */
interface GroupDocument {
  _id?: ObjectId
  name: string
}

/** Die „group_members“-Collection gehört Conectink – dieses Modul liest sie nur. */
interface GroupMemberDocument {
  groupId: string
  userId: string
  status: string
}

const stacks = () => getDb().collection<StackDocument>('stacks')
const stackGroups = () => getDb().collection<StackGroupDocument>('stack_groups')
const groups = () => getDb().collection<GroupDocument>('groups')
const groupMembers = () =>
  getDb().collection<GroupMemberDocument>('group_members')

/** Legt bei Bedarf die Indexe an (idempotent). */
async function ensureIndexes(): Promise<void> {
  await stackGroups().createIndex({ stackId: 1, groupId: 1 }, { unique: true })
  await stackGroups().createIndex({ groupId: 1 })
}

function toDto(
  document: WithId<StackDocument>,
  stackGroups: Array<{ id: string; name: string }>,
): StackDto {
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
    groups: stackGroups,
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
 * Besitzer. Zusätzlich sind Stacks sichtbar, die einer Gruppe zugeordnet
 * sind, in der der Nutzer akzeptiertes Mitglied ist (`groupStackIds`).
 *
 * Ohne gültige Session (`userId` fehlt) sind ausschließlich öffentliche
 * Stacks sichtbar. Ein `$or`-Zweig mit leerer `userId` würde fehlende
 * `userId`-Felder (anonym/legacy) fälschlich als eigenen Besitz matchen
 * und private Stacks leaken – deshalb wird er dann weggelassen.
 */
function visibleStacksFilter(
  userId?: string,
  groupStackIds: string[] = [],
): Filter<StackDocument> {
  if (!userId) {
    return { isPublic: { $ne: false } }
  }

  const or: Filter<StackDocument>[] = [{ isPublic: { $ne: false } }, { userId }]
  if (groupStackIds.length > 0) {
    or.push({ _id: { $in: groupStackIds.map((id) => new ObjectId(id)) } })
  }

  return { $or: or }
}

/** Gruppen-IDs, in denen der Nutzer akzeptiertes Mitglied ist. */
async function myGroupIds(userId: string): Promise<string[]> {
  const memberships = await groupMembers()
    .find({ userId, status: 'accepted' })
    .toArray()

  return [...new Set(memberships.map((membership) => membership.groupId))]
}

/** Stack-IDs, die einer der übergebenen Gruppen zugeordnet sind. */
async function stackIdsInGroups(groupIds: string[]): Promise<string[]> {
  if (groupIds.length === 0) {
    return []
  }

  const entries = await stackGroups()
    .find({ groupId: { $in: groupIds } })
    .toArray()

  return [...new Set(entries.map((entry) => entry.stackId))]
}

/** Löst die Gruppen (id + Name) je Stack auf. */
async function resolveStackGroups(
  stackIds: string[],
): Promise<Map<string, Array<{ id: string; name: string }>>> {
  if (stackIds.length === 0) {
    return new Map()
  }

  const entries = await stackGroups()
    .find({ stackId: { $in: stackIds } })
    .toArray()

  const groupIds = [...new Set(entries.map((entry) => entry.groupId))]
  const groupDocuments = await groups()
    .find({ _id: { $in: groupIds.map((id) => new ObjectId(id)) } })
    .toArray()
  const nameById = new Map(
    groupDocuments.map((group) => [group._id.toHexString(), group.name]),
  )

  const byStack = new Map<string, Array<{ id: string; name: string }>>()
  for (const entry of entries) {
    const list = byStack.get(entry.stackId) ?? []
    list.push({
      id: entry.groupId,
      name: nameById.get(entry.groupId) ?? 'Unbekannte Gruppe',
    })
    byStack.set(entry.stackId, list)
  }

  return byStack
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
  const groupStackIds = userId
    ? await stackIdsInGroups(await myGroupIds(userId))
    : []
  const document = await stacks().findOne({
    _id: new ObjectId(id),
    ...visibleStacksFilter(userId, groupStackIds),
  })
  if (!document) return null

  const groups =
    (await resolveStackGroups([document._id.toHexString()])).get(
      document._id.toHexString(),
    ) ?? []

  return toDto(document, groups)
}

/**
 * Liefert sichtbare Stacks: öffentliche, eigene und Stacks aus Gruppen,
 * in denen der Nutzer Mitglied ist. Mit `mine=true` nur die eigenen.
 */
export async function listStacks(
  userId?: string,
  mine = false,
): Promise<StackDto[]> {
  await ensureIndexes()

  if (mine && userId) {
    const documents = await stacks()
      .find({ userId })
      .sort({ name: 1 })
      .toArray()
    const groupsByStack = await resolveStackGroups(
      documents.map((document) => document._id.toHexString()),
    )
    return documents.map((document) =>
      toDto(document, groupsByStack.get(document._id.toHexString()) ?? []),
    )
  }

  const groupStackIds = userId
    ? await stackIdsInGroups(await myGroupIds(userId))
    : []
  const documents = await stacks()
    .find(visibleStacksFilter(userId, groupStackIds))
    .sort({ name: 1 })
    .toArray()
  const groupsByStack = await resolveStackGroups(
    documents.map((document) => document._id.toHexString()),
  )

  return documents.map((document) =>
    toDto(document, groupsByStack.get(document._id.toHexString()) ?? []),
  )
}

/** Existiert die Gruppe? */
async function groupExists(groupId: string): Promise<boolean> {
  const group = await groups().findOne({ _id: new ObjectId(groupId) })

  return group !== null
}

/** Ist der Nutzer akzeptiertes Mitglied der Gruppe? */
async function isGroupMember(
  userId: string,
  groupId: string,
): Promise<boolean> {
  const member = await groupMembers().findOne({
    groupId,
    userId,
    status: 'accepted',
  })

  return member !== null
}

/**
 * Validiert die Zielgruppen (existieren + Mitgliedschaft), bevor der Stack
 * geändert wird – so bleibt der Stack bei ungültigen Gruppen unverändert.
 */
async function validateStackGroups(
  userId: string,
  groupIds: string[],
): Promise<void> {
  for (const groupId of groupIds) {
    if (!(await groupExists(groupId))) {
      throw new HTTPException(404, { message: 'Gruppe nicht gefunden.' })
    }
    if (!(await isGroupMember(userId, groupId))) {
      throw new HTTPException(403, {
        message: 'Du bist kein Mitglied dieser Gruppe.',
      })
    }
  }
}

/** Ersetzt die Gruppen-Zuordnungen eines Stacks in `stack_groups`. */
async function replaceStackGroups(
  stackId: string,
  userId: string,
  groupIds: string[],
): Promise<void> {
  await stackGroups().deleteMany({ stackId })

  const now = new Date()
  for (const groupId of groupIds) {
    await stackGroups().insertOne({
      stackId,
      groupId,
      addedBy: userId,
      addedAt: now,
    })
  }
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
  const stackId = insertedId.toHexString()

  // Gruppen-Zuordnungen nur für angemeldete Nutzer (anonyme Stacks haben keine).
  if (userId && input.groupIds.length > 0) {
    await validateStackGroups(userId, input.groupIds)
    await replaceStackGroups(stackId, userId, input.groupIds)
  }

  const groups = (await resolveStackGroups([stackId])).get(stackId) ?? []

  return {
    id: stackId,
    name: input.name,
    creatorName: input.creatorName,
    examTime: input.examTime,
    passingScore: input.passingScore,
    isPublic,
    archived: false,
    questions: input.questions,
    leaderboard: [],
    groups,
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

  // Gruppen vorab validieren (existieren + Mitgliedschaft), damit der Stack
  // bei ungültigen Gruppen unverändert bleibt.
  await validateStackGroups(userId, input.groupIds)

  // 1) Normalfall: Nur der Besitzer darf bearbeiten.
  const owned = await stacks().updateOne(
    { _id: objectId, userId },
    { $set: set },
  )
  if (owned.matchedCount > 0) {
    await replaceStackGroups(id, userId, input.groupIds)
    return getStack(id, userId)
  }

  // 2) Claim: ungeclaimter öffentlicher Stack wird vom ersten
  //    Bearbeiter übernommen. Private Stacks Dritter sind nie
  //    übernehmbar (kein `isPublic: { $ne: false }`).
  const claimed = await stacks().updateOne(
    { _id: objectId, userId: { $exists: false }, isPublic: { $ne: false } },
    { $set: { ...set, userId } },
  )
  if (claimed.matchedCount > 0) {
    await replaceStackGroups(id, userId, input.groupIds)
    return getStack(id, userId)
  }

  return null
}

/**
 * Stacks einer Gruppe (sichtbar für akzeptierte Mitglieder, unabhängig von
 * `isPublic`). Wird vom Conectink-Endpunkt `/groups/:id/stacks` genutzt.
 */
export async function listGroupStacks(
  userId: string,
  groupId: string,
): Promise<StackDto[]> {
  await ensureIndexes()

  if (!(await groupExists(groupId))) {
    throw new HTTPException(404, { message: 'Gruppe nicht gefunden.' })
  }
  if (!(await isGroupMember(userId, groupId))) {
    throw new HTTPException(403, {
      message: 'Du bist kein Mitglied dieser Gruppe.',
    })
  }

  const entries = await stackGroups().find({ groupId }).toArray()
  const stackIds = [...new Set(entries.map((entry) => entry.stackId))]
  if (stackIds.length === 0) {
    return []
  }

  const documents = await stacks()
    .find({ _id: { $in: stackIds.map((id) => new ObjectId(id)) } })
    .sort({ name: 1 })
    .toArray()
  const groupsByStack = await resolveStackGroups(stackIds)

  return documents.map((document) =>
    toDto(document, groupsByStack.get(document._id.toHexString()) ?? []),
  )
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
  if (owned.matchedCount > 0) return true

  const claimed = await stacks().updateOne(
    { _id: objectId, userId: { $exists: false }, isPublic: { $ne: false } },
    { $set: { archived: true, userId } },
  )

  return claimed.matchedCount > 0
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
    return toDto(
      document,
      (await resolveStackGroups([document._id.toHexString()])).get(
        document._id.toHexString(),
      ) ?? [],
    )
  }

  const { modifiedCount } = await stacks().updateOne(
    { _id: new ObjectId(id) },
    { $set: { leaderboard: ranked } },
  )

  if (modifiedCount === 0) {
    return toDto(
      document,
      (await resolveStackGroups([document._id.toHexString()])).get(
        document._id.toHexString(),
      ) ?? [],
    )
  }

  const updated = (await getStackRaw(id)) ?? document
  return toDto(
    updated,
    (await resolveStackGroups([updated._id.toHexString()])).get(
      updated._id.toHexString(),
    ) ?? [],
  )
}
