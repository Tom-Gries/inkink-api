import { z } from 'zod'

const objectIdSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, 'Ungültige Benutzer-ID.')

export const userIdParamSchema = z.object({
  id: objectIdSchema,
})

/**
 * Öffentliches Benutzer-DTO ohne E-Mail-Adresse. Die „user"-Collection gehört Better Auth (Phase 3) –
 * dieses Modul liest sie nur.
 */
export interface UserDto {
  id: string
  name: string | null
}
