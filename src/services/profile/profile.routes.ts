import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { type AuthVariables, sessionMiddleware } from '../../hooks/auth'
import { validationErrorHook } from '../../hooks/validation'
import { updateUsernameSchema } from '../../schemas/profile'
import { getProfile, setUsername } from './profile.service'

export const profileRoutes = new Hono<{ Variables: AuthVariables }>()

/**
 * Session-basierter Schutz: Ohne gültige Session (Cookie) → 401.
 * Die userId stammt aus der Better-Auth-Session, nie aus dem Body.
 */
function requireUserId(
  session: { user?: { id?: string } | null } | null,
): string {
  const userId = session?.user?.id
  if (!userId) {
    throw new HTTPException(401, { message: 'Nicht angemeldet.' })
  }

  return userId
}

profileRoutes.get('/me', sessionMiddleware, async (c) => {
  const userId = requireUserId(c.get('session'))
  const profile = await getProfile(userId)

  return c.json({ profile })
})

profileRoutes.patch(
  '/me',
  sessionMiddleware,
  zValidator('json', updateUsernameSchema, validationErrorHook),
  async (c) => {
    const userId = requireUserId(c.get('session'))
    const { username } = c.req.valid('json')

    const profile = await setUsername(userId, username)

    return c.json({ profile })
  },
)
