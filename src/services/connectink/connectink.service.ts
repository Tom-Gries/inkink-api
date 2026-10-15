import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ObjectId, type WithId } from 'mongodb'
import { getDb } from '../../db.js'
import type {
  ConnectedUserDto,
  ConnectionStatus,
  ConnectRequestDto,
  CounterpartUserDto,
  GroupDto,
  GroupInvitationDto,
  GroupInvitationStatus,
  GroupManagement,
  GroupMemberDto,
  GroupRole,
  Relation,
  UpdateGroupInput,
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

/** Eine Gruppe (erstellt vom Owner, Richtlinie vom Owner änderbar). */
interface GroupDocument {
  _id?: ObjectId
  name: string
  ownerId: string
  management: GroupManagement
  createdAt: Date
  updatedAt: Date
}

/**
 * Gruppen-Eintrag (Mitglied oder Einladung), ein Dokument pro (Gruppe, Nutzer).
 * `status` steuert den Lebenszyklus: pending (offene Einladung) ? accepted
 * (aktives Mitglied) | rejected (kann erneut eingeladen werden) | ignored
 * (erneutes Einladen ist NICHT m�glich � wie bei Connect-Anfragen).
 */
interface GroupMemberDocument {
  _id?: ObjectId
  groupId: string
  userId: string
  role: GroupRole
  status: GroupInvitationStatus
  addedBy: string
  addedAt: Date
  updatedAt: Date
}

const connections = () => getDb().collection<ConnectionDocument>('connections')
const users = () => getDb().collection<UserDocument>('user')
const profiles = () => getDb().collection<ProfileDocument>('profile')
const groups = () => getDb().collection<GroupDocument>('groups')
const groupMembers = () =>
  getDb().collection<GroupMemberDocument>('group_members')

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
  await groups().createIndex({ ownerId: 1 })
  await groupMembers().createIndex({ groupId: 1, userId: 1 }, { unique: true })
  await groupMembers().createIndex({ userId: 1, status: 1 })
  await groupMembers().createIndex({ groupId: 1, status: 1 })
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
/* ------------------------------------------------------------------ */
/* Gruppen                                                             */
/* ------------------------------------------------------------------ */

/** Sind zwei Nutzer verbunden (acceptierte Verbindung in einer Richtung)? */
async function areConnected(userId: string, otherId: string): Promise<boolean> {
  const document = await connections().findOne({
    $or: [
      { fromUserId: userId, toUserId: otherId, status: 'accepted' },
      { fromUserId: otherId, toUserId: userId, status: 'accepted' },
    ],
  })

  return document !== null
}

/** Liefert die Rolle eines Nutzers in einer Gruppe (nur aktive Mitglieder). */
async function getRole(
  groupId: string,
  userId: string,
): Promise<GroupRole | null> {
  const member = await groupMembers().findOne({
    groupId,
    userId,
    status: 'accepted',
  })

  return member?.role ?? null
}

/** Darf der Nutzer (Rolle) ein Mitglied zur Gruppe hinzufügen? */
function canAddMember(role: GroupRole, management: GroupManagement): boolean {
  if (role === 'owner' || role === 'admin') return true

  return management === 'members_add' || management === 'members_full'
}

/** Darf der Nutzer (Rolle) ein Ziel-Mitglied (Rolle) entfernen? */
function canRemoveMember(
  role: GroupRole,
  management: GroupManagement,
  targetRole: GroupRole,
): boolean {
  if (targetRole === 'owner') return false
  if (role === 'owner') return true
  if (role === 'admin') return targetRole === 'member'

  // role === 'member'
  return management === 'members_full' && targetRole === 'member'
}

/** Darf der Nutzer (Rolle) die Gruppe umbenennen? */
function canRenameGroup(role: GroupRole): boolean {
  return role === 'owner' || role === 'admin'
}

/**
 * Baut das GroupDto aus Gruppe + aktiven Mitgliedern + offenen Einladungen
 * (jeweils nach Name sortiert).
 */
async function toGroupDto(
  group: WithId<GroupDocument>,
  members: Array<WithId<GroupMemberDocument>>,
  invitations: Array<WithId<GroupMemberDocument>>,
  myUserId: string,
): Promise<GroupDto> {
  const resolved = await resolveUsers([
    ...members.map((member) => member.userId),
    ...invitations.map((invitation) => invitation.userId),
  ])

  const toMemberDto = (entry: WithId<GroupMemberDocument>): GroupMemberDto => {
    const user = resolved.get(entry.userId) ?? fallbackUser(entry.userId)
    return {
      userId: entry.userId,
      name: user.name,
      image: user.image,
      role: entry.role,
      addedAt: entry.addedAt.toISOString(),
    }
  }

  const memberDtos = members
    .map(toMemberDto)
    .sort((a, b) => a.name.localeCompare(b.name))
  const invitationDtos = invitations
    .map(toMemberDto)
    .sort((a, b) => a.name.localeCompare(b.name))

  const myMember = members.find((member) => member.userId === myUserId)

  return {
    id: group._id.toHexString(),
    name: group.name,
    ownerId: group.ownerId,
    management: group.management,
    myRole: myMember?.role ?? 'member',
    createdAt: group.createdAt.toISOString(),
    members: memberDtos,
    invitations: invitationDtos,
  }
}

/** L�dt alle Eintr�ge einer Gruppe und teilt sie in Mitglieder + Einladungen. */
async function loadGroupEntries(groupId: string): Promise<{
  members: Array<WithId<GroupMemberDocument>>
  invitations: Array<WithId<GroupMemberDocument>>
}> {
  const entries = await groupMembers().find({ groupId }).toArray()

  return {
    members: entries.filter((entry) => entry.status === 'accepted'),
    invitations: entries.filter((entry) => entry.status === 'pending'),
  }
}

/** Erstellt eine Gruppe; der Ersteller wird automatisch Owner-Mitglied. */
export async function createGroup(
  ownerId: string,
  name: string,
): Promise<GroupDto> {
  await ensureIndexes()

  const now = new Date()
  const { insertedId } = await groups().insertOne({
    name,
    ownerId,
    management: 'owner',
    createdAt: now,
    updatedAt: now,
  })
  const groupId = insertedId.toHexString()

  await groupMembers().insertOne({
    groupId,
    userId: ownerId,
    role: 'owner',
    status: 'accepted',
    addedBy: ownerId,
    addedAt: now,
    updatedAt: now,
  })

  const owner =
    (await resolveUsers([ownerId])).get(ownerId) ?? fallbackUser(ownerId)

  return {
    id: groupId,
    name,
    ownerId,
    management: 'owner',
    myRole: 'owner',
    createdAt: now.toISOString(),
    members: [
      {
        userId: ownerId,
        name: owner.name,
        image: owner.image,
        role: 'owner',
        addedAt: now.toISOString(),
      },
    ],
    invitations: [],
  }
}

/** Meine Gruppen (Owner/Admin/Mitglied) inkl. Mitgliedern, nach Name sortiert. */
export async function listGroups(userId: string): Promise<GroupDto[]> {
  await ensureIndexes()

  const myMemberships = await groupMembers()
    .find({ userId, status: 'accepted' })
    .toArray()
  if (myMemberships.length === 0) {
    return []
  }

  const groupIds = [...new Set(myMemberships.map((member) => member.groupId))]

  const [groupDocuments, memberDocuments] = await Promise.all([
    groups()
      .find({ _id: { $in: groupIds.map((id) => new ObjectId(id)) } })
      .toArray(),
    groupMembers()
      .find({ groupId: { $in: groupIds } })
      .toArray(),
  ])

  const membersByGroup = new Map<string, Array<WithId<GroupMemberDocument>>>()
  const invitationsByGroup = new Map<
    string,
    Array<WithId<GroupMemberDocument>>
  >()

  for (const entry of memberDocuments) {
    const target =
      entry.status === 'accepted' ? membersByGroup : invitationsByGroup
    const list = target.get(entry.groupId) ?? []
    list.push(entry)
    target.set(entry.groupId, list)
  }

  const result: GroupDto[] = []
  for (const group of groupDocuments) {
    const groupId = group._id.toHexString()
    result.push(
      await toGroupDto(
        group,
        membersByGroup.get(groupId) ?? [],
        invitationsByGroup.get(groupId) ?? [],
        userId,
      ),
    )
  }

  return result.sort((a, b) => a.name.localeCompare(b.name))
}
/** Aktualisiert Name und/oder Richtlinie einer Gruppe (Owner/Admin). */
export async function updateGroup(
  userId: string,
  groupId: string,
  input: UpdateGroupInput,
): Promise<GroupDto> {
  await ensureIndexes()

  const group = await groups().findOne({ _id: new ObjectId(groupId) })
  if (!group) {
    throw new ConnectError(404, 'NOT_FOUND', 'Gruppe nicht gefunden.')
  }

  const myRole = await getRole(groupId, userId)
  if (!myRole) {
    throw new ConnectError(
      403,
      'FORBIDDEN',
      'Du bist kein Mitglied dieser Gruppe.',
    )
  }

  if (input.management !== undefined && myRole !== 'owner') {
    throw new ConnectError(
      403,
      'OWNER_ONLY',
      'Nur der Ersteller kann die Richtlinie ändern.',
    )
  }
  if (input.name !== undefined && !canRenameGroup(myRole)) {
    throw new ConnectError(
      403,
      'FORBIDDEN',
      'Du darfst die Gruppe nicht umbenennen.',
    )
  }

  const set: Partial<Pick<GroupDocument, 'name' | 'management'>> & {
    updatedAt: Date
  } = { updatedAt: new Date() }
  if (input.name !== undefined) set.name = input.name
  if (input.management !== undefined) set.management = input.management

  await groups().updateOne({ _id: group._id }, { $set: set })

  const { members, invitations } = await loadGroupEntries(groupId)

  return toGroupDto({ ...group, ...set }, members, invitations, userId)
}

/** Löscht eine Gruppe samt aller Mitgliedsdokumente (nur Owner). */
export async function deleteGroup(
  userId: string,
  groupId: string,
): Promise<void> {
  await ensureIndexes()

  const group = await groups().findOne({ _id: new ObjectId(groupId) })
  if (!group) {
    throw new ConnectError(404, 'NOT_FOUND', 'Gruppe nicht gefunden.')
  }
  if (group.ownerId !== userId) {
    throw new ConnectError(
      403,
      'OWNER_ONLY',
      'Nur der Ersteller kann die Gruppe löschen.',
    )
  }

  await groups().deleteOne({ _id: group._id })
  await groupMembers().deleteMany({ groupId })
}

/**
 * Lädt einen verbundenen Freund in die Gruppe ein. Der Eingeladene muss die
 * Einladung erst annehmen (accept), um Mitglied zu werden. Regelwerk (wie bei
 * Connect-Anfragen): abgelehnt → erneut einladen erlaubt; ignoriert → erneutes
 * Einladen ist NICHT möglich.
 */
export async function addGroupMember(
  userId: string,
  groupId: string,
  targetUserId: string,
): Promise<GroupDto> {
  await ensureIndexes()

  const group = await groups().findOne({ _id: new ObjectId(groupId) })
  if (!group) {
    throw new ConnectError(404, 'NOT_FOUND', 'Gruppe nicht gefunden.')
  }

  if (targetUserId === group.ownerId) {
    throw new ConnectError(
      400,
      'BAD_REQUEST',
      'Der Ersteller ist bereits Mitglied der Gruppe.',
    )
  }

  const myRole = await getRole(groupId, userId)
  if (!myRole) {
    throw new ConnectError(
      403,
      'FORBIDDEN',
      'Du bist kein Mitglied dieser Gruppe.',
    )
  }
  if (!canAddMember(myRole, group.management)) {
    throw new ConnectError(
      403,
      'FORBIDDEN',
      'Du darfst hier keine Einladungen verschicken.',
    )
  }

  const target = await users().findOne({ _id: new ObjectId(targetUserId) })
  if (!target) {
    throw new ConnectError(404, 'NOT_FOUND', 'Benutzer nicht gefunden.')
  }

  const existing = await groupMembers().findOne({
    groupId,
    userId: targetUserId,
  })

  if (existing) {
    if (existing.status === 'accepted') {
      throw new ConnectError(
        409,
        'ALREADY_MEMBER',
        'Diese Person ist bereits Mitglied der Gruppe.',
      )
    }
    if (existing.status === 'pending') {
      throw new ConnectError(
        409,
        'ALREADY_INVITED',
        'Eine Einladung ist bereits offen.',
      )
    }
    if (existing.status === 'ignored') {
      throw new ConnectError(
        409,
        'IGNORED',
        'Diese Person ignoriert Einladungen dieser Gruppe.',
      )
    }

    // status === 'rejected' → erneutes Einladen ist erlaubt: reaktivieren.
    const now = new Date()
    await groupMembers().updateOne(
      { _id: existing._id },
      { $set: { status: 'pending', updatedAt: now } },
    )
  } else {
    if (!(await areConnected(userId, targetUserId))) {
      throw new ConnectError(
        400,
        'NOT_CONNECTED',
        'Nur verbundene Freunde können eingeladen werden.',
      )
    }

    const now = new Date()
    await groupMembers().insertOne({
      groupId,
      userId: targetUserId,
      role: 'member',
      status: 'pending',
      addedBy: userId,
      addedAt: now,
      updatedAt: now,
    })
  }

  const { members, invitations } = await loadGroupEntries(groupId)

  return toGroupDto(group, members, invitations, userId)
}

/** Entfernt ein Mitglied (laut Rollen-/Richtlinien-Matrix). */
export async function removeGroupMember(
  userId: string,
  groupId: string,
  targetUserId: string,
): Promise<GroupDto> {
  await ensureIndexes()

  const group = await groups().findOne({ _id: new ObjectId(groupId) })
  if (!group) {
    throw new ConnectError(404, 'NOT_FOUND', 'Gruppe nicht gefunden.')
  }

  if (targetUserId === group.ownerId) {
    throw new ConnectError(
      400,
      'BAD_REQUEST',
      'Der Ersteller kann nicht entfernt werden.',
    )
  }

  const myRole = await getRole(groupId, userId)
  if (!myRole) {
    throw new ConnectError(
      403,
      'FORBIDDEN',
      'Du bist kein Mitglied dieser Gruppe.',
    )
  }

  const targetMember = await groupMembers().findOne({
    groupId,
    userId: targetUserId,
  })
  if (!targetMember) {
    throw new ConnectError(
      404,
      'NOT_FOUND',
      'Diese Person ist kein Mitglied der Gruppe.',
    )
  }

  if (!canRemoveMember(myRole, group.management, targetMember.role)) {
    throw new ConnectError(
      403,
      'FORBIDDEN',
      'Du darfst dieses Mitglied nicht entfernen.',
    )
  }

  await groupMembers().deleteOne({ groupId, userId: targetUserId })

  const { members, invitations } = await loadGroupEntries(groupId)

  return toGroupDto(group, members, invitations, userId)
}

/** ernennt ein Mitglied zum Admin (nur Owner). */
export async function setGroupAdmin(
  userId: string,
  groupId: string,
  targetUserId: string,
): Promise<GroupDto> {
  await ensureIndexes()

  const group = await groups().findOne({ _id: new ObjectId(groupId) })
  if (!group) {
    throw new ConnectError(404, 'NOT_FOUND', 'Gruppe nicht gefunden.')
  }
  if (group.ownerId !== userId) {
    throw new ConnectError(
      403,
      'OWNER_ONLY',
      'Nur der Ersteller kann Admins ernennen.',
    )
  }

  const targetMember = await groupMembers().findOne({
    groupId,
    userId: targetUserId,
    status: 'accepted',
  })
  if (!targetMember) {
    throw new ConnectError(
      404,
      'NOT_FOUND',
      'Diese Person ist kein Mitglied der Gruppe.',
    )
  }
  if (targetMember.role === 'owner') {
    throw new ConnectError(
      400,
      'BAD_REQUEST',
      'Der Ersteller ist bereits Owner.',
    )
  }
  if (targetMember.role === 'admin') {
    throw new ConnectError(
      409,
      'ALREADY_ADMIN',
      'Diese Person ist bereits Admin.',
    )
  }

  await groupMembers().updateOne(
    { groupId, userId: targetUserId },
    { $set: { role: 'admin' } },
  )

  const { members, invitations } = await loadGroupEntries(groupId)

  return toGroupDto(group, members, invitations, userId)
}

/** Entzieht den Admin-Status (nur Owner). */
export async function removeGroupAdmin(
  userId: string,
  groupId: string,
  targetUserId: string,
): Promise<GroupDto> {
  await ensureIndexes()

  const group = await groups().findOne({ _id: new ObjectId(groupId) })
  if (!group) {
    throw new ConnectError(404, 'NOT_FOUND', 'Gruppe nicht gefunden.')
  }
  if (group.ownerId !== userId) {
    throw new ConnectError(
      403,
      'OWNER_ONLY',
      'Nur der Ersteller kann Admins entziehen.',
    )
  }

  const targetMember = await groupMembers().findOne({
    groupId,
    userId: targetUserId,
    status: 'accepted',
  })
  if (!targetMember) {
    throw new ConnectError(
      404,
      'NOT_FOUND',
      'Diese Person ist kein Mitglied der Gruppe.',
    )
  }
  if (targetMember.role !== 'admin') {
    throw new ConnectError(400, 'BAD_REQUEST', 'Diese Person ist kein Admin.')
  }

  await groupMembers().updateOne(
    { groupId, userId: targetUserId },
    { $set: { role: 'member' } },
  )

  const { members, invitations } = await loadGroupEntries(groupId)

  return toGroupDto(group, members, invitations, userId)
}
/**
 * Offene Einladungen, die MIR gestellt wurden (pending) – inkl. Gruppe und
 * einladendem Nutzer.
 */
export async function listGroupInvitations(
  userId: string,
): Promise<GroupInvitationDto[]> {
  await ensureIndexes()

  const invitationDocuments = await groupMembers()
    .find({ userId, status: 'pending' })
    .sort({ addedAt: -1 })
    .toArray()

  if (invitationDocuments.length === 0) {
    return []
  }

  const groupIds = [
    ...new Set(invitationDocuments.map((invitation) => invitation.groupId)),
  ]
  const inviterIds = [
    ...new Set(invitationDocuments.map((invitation) => invitation.addedBy)),
  ]

  const [groupDocuments, inviterMap] = await Promise.all([
    groups()
      .find({ _id: { $in: groupIds.map((id) => new ObjectId(id)) } })
      .toArray(),
    resolveUsers(inviterIds),
  ])

  const groupById = new Map(
    groupDocuments.map((group) => [group._id.toHexString(), group]),
  )

  return invitationDocuments.map((invitation) => {
    const group = groupById.get(invitation.groupId)
    const inviter =
      inviterMap.get(invitation.addedBy) ?? fallbackUser(invitation.addedBy)

    return {
      id: invitation._id.toHexString(),
      group: {
        id: invitation.groupId,
        name: group?.name ?? 'Unbekannte Gruppe',
      },
      invitedBy: inviter,
      status: invitation.status,
      createdAt: invitation.addedAt.toISOString(),
    }
  })
}

/**
 * Bearbeitet eine Einladung (accept/reject/ignore). Nur der Eingeladene darf
 * das (userId). Akzeptieren → aktives Mitglied; Ablehnen → erneutes Einladen
 * erlaubt; Ignorieren → erneutes Einladen blockiert (wie bei Connect-Anfragen).
 */
export async function resolveGroupInvitation(
  userId: string,
  groupId: string,
  action: 'accept' | 'reject' | 'ignore',
): Promise<GroupInvitationDto> {
  await ensureIndexes()

  const invitation = await groupMembers().findOne({
    groupId,
    userId,
    status: 'pending',
  })

  if (!invitation) {
    throw new ConnectError(404, 'NOT_FOUND', 'Einladung nicht gefunden.')
  }

  const nextStatus =
    action === 'accept'
      ? 'accepted'
      : action === 'reject'
        ? 'rejected'
        : 'ignored'

  await groupMembers().updateOne(
    { _id: invitation._id },
    { $set: { status: nextStatus, updatedAt: new Date() } },
  )

  const group = await groups().findOne({ _id: new ObjectId(groupId) })
  const inviter =
    (await resolveUsers([invitation.addedBy])).get(invitation.addedBy) ??
    fallbackUser(invitation.addedBy)

  return {
    id: invitation._id.toHexString(),
    group: {
      id: groupId,
      name: group?.name ?? 'Unbekannte Gruppe',
    },
    invitedBy: inviter,
    status: nextStatus,
    createdAt: invitation.addedAt.toISOString(),
  }
}
