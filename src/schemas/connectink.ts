import { z } from 'zod'

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Ungültige ID.')

/** Status einer Connect-Beziehung zwischen zwei Nutzern (gerichtete Anfrage). */
export const connectionStatusSchema = z.enum([
  'pending',
  'accepted',
  'rejected',
  'ignored',
])

export type ConnectionStatus = z.infer<typeof connectionStatusSchema>

/** Suchbegriff für die Nutzer-Suche (optional – ohne q wird nichts gesucht). */
export const searchUsersQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(1, 'Suchbegriff darf nicht leer sein.')
    .max(40, 'Suchbegriff ist zu lang (max. 40 Zeichen).')
    .optional(),
})

/** Body für das Stellen einer Connect-Anfrage. */
export const connectRequestInputSchema = z.object({
  toUserId: objectIdSchema,
})

/** Param für Anfragen-/Verbindungs-IDs (24-stellige Hex-ObjectId). */
export const connectionIdParamSchema = z.object({
  id: objectIdSchema,
})

/** Relation des anfragenden Nutzers zu einem gefundenen Nutzer. */
export const relationSchema = z.enum([
  'none',
  'outgoingPending',
  'incomingPending',
  'accepted',
  'rejected',
  'ignored',
])

export type Relation = z.infer<typeof relationSchema>

/** Nutzer-Treffer inkl. Relation, wie die API ihn für die Suche liefert. */
export interface UserSearchDto {
  id: string
  name: string
  image: string | null
  relation: Relation
}

/** Kompakter Gegenüber-Nutzer für Anfragen/Verbindungen. */
export interface CounterpartUserDto {
  id: string
  name: string
  image: string | null
}

/** Connect-Anfrage (eingehend oder ausgehend). */
export interface ConnectRequestDto {
  id: string
  user: CounterpartUserDto
  createdAt: string
  /** 'incoming' = an mich gerichtet, 'outgoing' = von mir gesendet. */
  direction: 'incoming' | 'outgoing'
}

/** Verbundener Nutzer in der Verbunden-Liste. */
export interface ConnectedUserDto {
  id: string
  user: CounterpartUserDto
  since: string
}

/**
 * Verwaltungs-Richtlinie einer Gruppe (vom Owner änderbar).
 * - `owner`: nur Owner + Admins verwalten (hinzufügen/entfernen)
 * - `members_add`: alle Mitglieder dürfen verbundene Freunde hinzufügen
 * - `members_full`: alle Mitglieder dürfen verbundene Freunde hinzufügen
 *                   und (normale) Mitglieder entfernen
 */
export const groupManagementSchema = z.enum([
  'owner',
  'members_add',
  'members_full',
])

export type GroupManagement = z.infer<typeof groupManagementSchema>

/** Rolle eines Mitglieds in einer Gruppe. */
export const groupRoleSchema = z.enum(['owner', 'admin', 'member'])

export type GroupRole = z.infer<typeof groupRoleSchema>

/** Body für das Erstellen einer Gruppe. */
export const createGroupSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Gruppenname darf nicht leer sein.')
    .max(40, 'Gruppenname ist zu lang (max. 40 Zeichen).'),
})

/** Body für das Aktualisieren einer Gruppe (Name und/oder Richtlinie). */
export const updateGroupSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Gruppenname darf nicht leer sein.')
      .max(40, 'Gruppenname ist zu lang (max. 40 Zeichen).')
      .optional(),
    management: groupManagementSchema.optional(),
  })
  .refine(
    (input) => input.name !== undefined || input.management !== undefined,
    { message: 'Mindestens ein Feld (Name oder Richtlinie) angeben.' },
  )

export type UpdateGroupInput = z.infer<typeof updateGroupSchema>

/** Body für Mitglied-hinzufügen / Admin-ernennen. */
export const groupUserInputSchema = z.object({
  userId: objectIdSchema,
})

/** Param für Gruppen-IDs (24-stellige Hex-ObjectId). */
export const groupIdParamSchema = z.object({
  id: objectIdSchema,
})

/** Param für Gruppe + Nutzer (z. B. Mitglied entfernen). */
export const groupUserIdParamSchema = z.object({
  id: objectIdSchema,
  userId: objectIdSchema,
})

/** Mitglied einer Gruppe (mit aufgelöstem Nutzer). */
export interface GroupMemberDto {
  userId: string
  name: string
  image: string | null
  role: GroupRole
  addedAt: string
}

/** Status einer Gruppen-Einladung (identisch zu Connect-Anfragen). */
export const groupInvitationStatusSchema = connectionStatusSchema

export type GroupInvitationStatus = ConnectionStatus

/** Gruppe inkl. meiner Rolle, Richtlinie, Mitgliedern und offenen Einladungen. */
export interface GroupDto {
  id: string
  name: string
  ownerId: string
  management: GroupManagement
  /** Rolle des anfragenden Nutzers in dieser Gruppe. */
  myRole: GroupRole
  createdAt: string
  /** Aktive Mitglieder (acceptierte Einladungen + Owner). */
  members: GroupMemberDto[]
  /** Offene Einladungen (warten auf Antwort). */
  invitations: GroupMemberDto[]
}

/** Offene Gruppen-Einladung (an mich), mit Gruppe und Einladendem. */
export interface GroupInvitationDto {
  id: string
  group: { id: string; name: string }
  invitedBy: CounterpartUserDto
  status: GroupInvitationStatus
  createdAt: string
}
