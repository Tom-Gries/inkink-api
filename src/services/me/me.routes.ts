import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { type AuthVariables, sessionMiddleware } from '../../hooks/auth'

export const meRoutes = new Hono<{ Variables: AuthVariables }>().get(
  '/',
  sessionMiddleware,
  (c) => {
    const session = c.get('session')

    if (!session) {
      throw new HTTPException(401, { message: 'Nicht angemeldet.' })
    }

    return c.json({ user: session.user })
  },
)
