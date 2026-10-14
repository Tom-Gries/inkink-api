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
