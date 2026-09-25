import { z } from 'zod'

/**
 * Profil eines Nutzers. Verknüpft mit der Better-Auth-"user"-Collection
 * über `userId`; die App verwaltet hier eigene Felder (z. B. `username`)
 * unabhängig von Better Auth.
 */
export interface ProfileDto {
  userId: string
  username: string | null
}

export const updateUsernameSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, 'Benutzername darf nicht leer sein.')
    .max(40, 'Benutzername ist zu lang (max. 40 Zeichen).'),
})
