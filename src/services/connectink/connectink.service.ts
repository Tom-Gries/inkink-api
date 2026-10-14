import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ObjectId } from 'mongodb'
import { getDb } from '../../db.js'
import type {
  ConnectedUserDto,
  ConnectionStatus,
  ConnectRequestDto,
  CounterpartUserDto,
  Relation,
  UserSearchDto,
} from '../../schemas/connectink.js'

/**
 * Business-Fehler von Conectink mit HTTP-Status und stabilem Fehlercode.
 * Wird in den Routen in das einheitliche Format `{ error: { code, message } }`
 * übersetzt.
 */
export class ConnectError extends Error {
  readonly status: ContentfulStatusCode
  readonly code: string

  constructor(status: ContentfulStatusCode, code: string, message: string) {
    super(message)
    this.name = 'ConnectError'
    this.status = status
    this.code = code
  }
}

/**
 * Ein Connect-Eintrag pro gerichteter Beziehung (fromUserId → toUserId).
 * Die userIds stammen aus der Better-Auth-Session bzw. der `user`-Collection –
 * nie aus dem Request-Body (außer toUserId der Anfrage).
 */
interface ConnectionDocument {
  _id?: ObjectId
  fromUserId: string
  toUserId: string
  status: ConnectionStatus
  createdAt: Date
  updatedAt: Date
}

/** Die „user“-Collection gehört Better Auth – dieses Modul liest sie nur. */
interface UserDocument {
  _id?: ObjectId
  name?: string | null
  image?: string | null
  createdAt?: Date
}

/** App-eigene Profil-Collection (userId + username), wie im profile-Service. */
interface ProfileDocument {
  userId: string
  username: string | null
}

const connections = () => getDb().collection<ConnectionDocument>('connections')
const users = () => getDb().collection<UserDocument>('user')
const profiles = () => getDb().collection<ProfileDocument>('profile')

/**
 * Legt bei Bedarf die Indexe an (idempotent) – so bleibt die API ohne
 * separates Setup-Skript sinterbar.
 */
async function ensureIndexes(): Promise<void> {
  await connections().createIndex(
    { fromUserId: 1, toUserId: 1 },
    { unique: true },
  )
  await connections().createIndex({ toUserId: 1, status: 1 })
  await connections().createIndex({ fromUserId: 1, status: 1 })
}

/** Fallback für nicht (mehr) existierende Nutzer. */
function fallbackUser(id: string): CounterpartUserDto {
  return { id, name: 'Unbekannt', image: null }
}

/**
 * Löst Nutzer-IDs zu Anzeigenamen + Bild auf. Anzeigename = `username`
 * (Profil) mit Fallback auf den Google-`name` der `user`-Collection.
 */
async function resolveUsers(
  ids: string[],
): Promise<Map<string, CounterpartUserDto>> {
  if (ids.length === 0) {
    return new Map()
  }

  const uniqueIds = [...new Set(ids)]

  const [userDocuments, profileDocuments] = await Promise.all([
    users()
      .find({ _id: { $in: uniqueIds.map((id) => new ObjectId(id)) } })
      .toArray(),
    profiles()
      .find({ userId: { $in: uniqueIds } })
      .toArray(),
  ])

  const usernameByUserId = new Map(
    profileDocuments.map((profile) => [profile.userId, profile.username]),
  )

  const resolved = new Map<string, CounterpartUserDto>()

  for (const document of userDocuments) {
    const id = document._id.toHexString()
    const username = usernameByUserId.get(id)
    resolved.set(id, {
      id,
      name: username ?? document.name ?? 'Unbekannt',
      image: document.image ?? null,
    })
  }

  for (const id of uniqueIds) {
    resolved.set(id, resolved.get(id) ?? fallbackUser(id))
  }

  return resolved
}

/**
 * Suche Nutzer per Name/Username (case-insensitive Teilstring).
 * Die eigene Person wird ausgeschlossen; jeder Treffer enthält die aktuelle
 * `relation` des anfragenden Nutzers zu ihm (für die Button-Logik der UI).
 */
export async function searchUsers(
  userId: string,
  query: string,
): Promise<UserSearchDto[]> {
  await ensureIndexes()

  const q = query.trim()
  if (!q) {
    return []
  }

  const me = new ObjectId(userId)

  // Treffer über den Google-Namen (user.name) …
  const nameMatches = await users()
    .find({ _id: { $ne: me }, name: { $regex: q, $options: 'i' } })
    .toArray()

  // … und über den eigenen Benutzernamen (profile.username).
  const profileMatches = await profiles()
    .find({ username: { $regex: q, $options: 'i' } })
    .toArray()

  const candidateIds = new Map<string, ObjectId>()

  for (const document of nameMatches) {
    if (!document._id.equals(me)) {
      candidateIds.set(document._id.toHexString(), document._id)
    }
  }

  for (const profile of profileMatches) {
    if (profile.userId === userId) {
      continue
    }
    candidateIds.set(profile.userId, new ObjectId(profile.userId))
  }

  if (candidateIds.size === 0) {
    return []
  }

  const ids = [...candidateIds.keys()]
  const resolved = await resolveUsers(ids)

  // Alle relevanten Connections in einem Batch laden (beide Richtungen).
  const relationDocuments = await connections()
    .find({
      $or: [
        { fromUserId: userId, toUserId: { $in: ids } },
        { fromUserId: { $in: ids }, toUserId: userId },
      ],
    })
    .toArray()

  const outgoingByTarget = new Map<string, ConnectionDocument>()
  const incomingByTarget = new Map<string, ConnectionDocument>()

  for (const document of relationDocuments) {
    if (document.fromUserId === userId) {
      outgoingByTarget.set(document.toUserId, document)
    } else {
      incomingByTarget.set(document.fromUserId, document)
    }
  }

  function relationFor(id: string): Relation {
    const outgoing = outgoingByTarget.get(id)
    if (outgoing) {
      if (outgoing.status === 'accepted') return 'accepted'
      if (outgoing.status === 'pending') return 'outgoingPending'
      if (outgoing.status === 'rejected') return 'rejected'
      if (outgoing.status === 'ignored') return 'ignored'
    }

    const incoming = incomingByTarget.get(id)
    if (incoming?.status === 'accepted') return 'accepted'
    if (incoming?.status === 'pending') return 'incomingPending'

    return 'none'
  }

  return ids
    .map((id) => {
      const user = resolved.get(id) ?? fallbackUser(id)
      return {
        id,
        name: user.name,
        image: user.image,
        relation: relationFor(id),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Offene (pending) Anfragen – eingehend und ausgehend – mit Gegenüber. */
export async function listRequests(userId: string): Promise<{
  incoming: ConnectRequestDto[]
  outgoing: ConnectRequestDto[]
}> {
  await ensureIndexes()

  const [incomingDocuments, outgoingDocuments] = await Promise.all([
    connections()
      .find({ toUserId: userId, status: 'pending' })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray(),
    connections()
      .find({ fromUserId: userId, status: 'pending' })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray(),
  ])

  const otherIds = [
    ...incomingDocuments.map((document) => document.fromUserId),
    ...outgoingDocuments.map((document) => document.toUserId),
  ]
  const resolved = await resolveUsers(otherIds)

  const incoming = incomingDocuments.map((document) => ({
    id: document._id.toHexString(),
    user:
      resolved.get(document.fromUserId) ?? fallbackUser(document.fromUserId),
    createdAt: document.createdAt.toISOString(),
    direction: 'incoming' as const,
  }))

  const outgoing = outgoingDocuments.map((document) => ({
    id: document._id.toHexString(),
    user: resolved.get(document.toUserId) ?? fallbackUser(document.toUserId),
    createdAt: document.createdAt.toISOString(),
    direction: 'outgoing' as const,
  }))

  return { incoming, outgoing }
}

/**
 * Stellt eine Connect-Anfrage. Regelwerk:
 * - Anfrage an sich selbst → 400
 * - Ziel muss existieren → 404
 * - Bereits verbunden / Anfrage offen → 409
 * - Ignoriert (Soft-Block) → 409 – erneutes Anfragen ist NICHT möglich
 * - Abgelehnt → erneutes Anfragen ist erlaubt (Eintrag wird reaktiviert)
 * - Umgekehrte offene Anfrage → 409 mit Hinweis, stattdessen zu akzeptieren
 */
export async function sendRequest(
  fromUserId: string,
  toUserId: string,
): Promise<ConnectRequestDto> {
  await ensureIndexes()

  if (fromUserId === toUserId) {
    throw new ConnectError(
      400,
      'SELF_CONNECTION',
      'Du kannst dich nicht selbst anfragen.',
    )
  }

  const target = await users().findOne({ _id: new ObjectId(toUserId) })
  if (!target) {
    throw new ConnectError(404, 'NOT_FOUND', 'Benutzer nicht gefunden.')
  }

  const existing = await connections().findOne({ fromUserId, toUserId })

  if (existing) {
    if (existing.status === 'accepted') {
      throw new ConnectError(
        409,
        'ALREADY_CONNECTED',
        'Ihr seid bereits verbunden.',
      )
    }
    if (existing.status === 'pending') {
      throw new ConnectError(
        409,
        'ALREADY_REQUESTED',
        'Eine Anfrage ist bereits offen.',
      )
    }
    if (existing.status === 'ignored') {
      throw new ConnectError(
        409,
        'IGNORED',
        'Diese Person ignoriert deine Anfragen.',
      )
    }

    // status === 'rejected' → erneutes Anfragen ist erlaubt: reaktivieren.
    const now = new Date()
    await connections().updateOne(
      { _id: existing._id },
      { $set: { status: 'pending', updatedAt: now } },
    )

    return {
      id: existing._id.toHexString(),
      user:
        (await resolveUsers([toUserId])).get(toUserId) ??
        fallbackUser(toUserId),
      createdAt: existing.createdAt.toISOString(),
      direction: 'outgoing',
    }
  }

  const reverse = await connections().findOne({
    fromUserId: toUserId,
    toUserId: fromUserId,
  })
  if (reverse?.status === 'pending') {
    throw new ConnectError(
      409,
      'REVERSE_PENDING',
      'Diese Person hat dir bereits eine Anfrage geschickt – du kannst sie akzeptieren.',
    )
  }

  const now = new Date()
  const { insertedId } = await connections().insertOne({
    fromUserId,
    toUserId,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  })

  return {
    id: insertedId.toHexString(),
    user:
      (await resolveUsers([toUserId])).get(toUserId) ?? fallbackUser(toUserId),
    createdAt: now.toISOString(),
    direction: 'outgoing',
  }
}

/**
 * Bearbeitet eine eingehende Anfrage. Nur der Empfänger darf das (toUserId).
 * Bei `accept` wird eine evtl. offene umgekehrte Anfrage ebenfalls akzeptiert –
 * beide sind dann verbunden.
 */
export async function resolveRequest(
  userId: string,
  id: string,
  action: 'accept' | 'reject' | 'ignore',
): Promise<ConnectRequestDto> {
  await ensureIndexes()

  const document = await connections().findOne({ _id: new ObjectId(id) })

  if (!document || document.toUserId !== userId) {
    throw new ConnectError(404, 'NOT_FOUND', 'Anfrage nicht gefunden.')
  }

  if (document.status !== 'pending') {
    throw new ConnectError(
      409,
      'ALREADY_RESOLVED',
      'Diese Anfrage wurde bereits bearbeitet.',
    )
  }

  const now = new Date()
  const nextStatus =
    action === 'accept'
      ? 'accepted'
      : action === 'reject'
        ? 'rejected'
        : 'ignored'

  await connections().updateOne(
    { _id: document._id },
    { $set: { status: nextStatus, updatedAt: now } },
  )

  if (action === 'accept') {
    await connections().updateOne(
      { fromUserId: userId, toUserId: document.fromUserId, status: 'pending' },
      { $set: { status: 'accepted', updatedAt: now } },
    )
  }

  return {
    id: document._id.toHexString(),
    user:
      (await resolveUsers([document.fromUserId])).get(document.fromUserId) ??
      fallbackUser(document.fromUserId),
    createdAt: document.createdAt.toISOString(),
    direction: 'incoming',
  }
}

/** Verbundene Nutzer (acceptierte Einträge, dedupliziert pro Gegenüber). */
export async function listConnections(
  userId: string,
): Promise<ConnectedUserDto[]> {
  await ensureIndexes()

  const documents = await connections()
    .find({
      $or: [
        { fromUserId: userId, status: 'accepted' },
        { toUserId: userId, status: 'accepted' },
      ],
    })
    .toArray()

  const byOther = new Map<string, { id: string; since: Date }>()

  for (const document of documents) {
    const other =
      document.fromUserId === userId ? document.toUserId : document.fromUserId
    const since = document.createdAt
    const current = byOther.get(other)

    if (!current || since < current.since) {
      byOther.set(other, { id: document._id.toHexString(), since })
    }
  }

  const resolved = await resolveUsers([...byOther.keys()])

  return [...byOther.entries()]
    .map(([otherId, { id, since }]) => ({
      id,
      user: resolved.get(otherId) ?? fallbackUser(otherId),
      since: since.toISOString(),
    }))
    .sort((a, b) => a.user.name.localeCompare(b.user.name))
}

/**
 * Entfernt eine Verbindung: löscht ALLE Einträge zwischen mir und dem
 * Gegenüber (beide Richtungen), sodass danach neu angefragt werden kann.
 * Nur acceptierte Verbindungen, an denen ich beteiligt bin, sind entfernbar.
 */
export async function removeConnection(
  userId: string,
  id: string,
): Promise<void> {
  await ensureIndexes()

  const document = await connections().findOne({ _id: new ObjectId(id) })

  if (
    !document ||
    document.status !== 'accepted' ||
    (document.fromUserId !== userId && document.toUserId !== userId)
  ) {
    throw new ConnectError(404, 'NOT_FOUND', 'Verbindung nicht gefunden.')
  }

  const other =
    document.fromUserId === userId ? document.toUserId : document.fromUserId

  await connections().deleteOne({ fromUserId: userId, toUserId: other })
  await connections().deleteOne({ fromUserId: other, toUserId: userId })
}
