import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { type AuthVariables, sessionMiddleware } from '../../hooks/auth.js'
import { validationErrorHook } from '../../hooks/validation.js'
import {
  leaderboardEntrySchema,
  stackIdParamSchema,
  stackInputSchema,
} from '../../schemas/stack.js'
import {
  addLeaderboardEntry,
  archiveStack,
  createStack,
  getStack,
  listStacks,
  updateStack,
} from './stacks.service.js'

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

/**
 * userId aus der Session – oder undefined für anonyme Zugriffe.
 * Lese-Endpoints und das Anlegen sind auch ohne Login erlaubt
 * (öffentliche Stacks), Schreiboperationen verlangen eine Session.
 */
function optionalUserId(
  session: { user?: { id?: string } | null } | null,
): string | undefined {
  return session?.user?.id
}

export const stacksRoutes = new Hono<{ Variables: AuthVariables }>()
  .get('/', sessionMiddleware, async (c) => {
    const userId = optionalUserId(c.get('session'))

    return c.json(await listStacks(userId))
  })
  .get(
    '/:id',
    sessionMiddleware,
    zValidator('param', stackIdParamSchema, validationErrorHook),
    async (c) => {
      const userId = optionalUserId(c.get('session'))
      const { id } = c.req.valid('param')
      const stack = await getStack(id, userId)

      if (!stack) {
        return c.json(
          { error: { code: 'NOT_FOUND', message: 'Stack nicht gefunden.' } },
          404,
        )
      }

      return c.json(stack)
    },
  )
  .post(
    '/',
    sessionMiddleware,
    zValidator('json', stackInputSchema, validationErrorHook),
    async (c) => {
      const userId = optionalUserId(c.get('session'))
      const input = c.req.valid('json')
      return c.json(await createStack(userId, input), 201)
    },
  )
  .put(
    '/:id',
    sessionMiddleware,
    zValidator('param', stackIdParamSchema, validationErrorHook),
    zValidator('json', stackInputSchema, validationErrorHook),
    async (c) => {
      const userId = requireUserId(c.get('session'))
      const { id } = c.req.valid('param')
      const input = c.req.valid('json')
      const stack = await updateStack(id, userId, input)

      if (!stack) {
        return c.json(
          { error: { code: 'NOT_FOUND', message: 'Stack nicht gefunden.' } },
          404,
        )
      }

      return c.json(stack)
    },
  )
  .post(
    '/:id/archive',
    sessionMiddleware,
    zValidator('param', stackIdParamSchema, validationErrorHook),
    async (c) => {
      const userId = requireUserId(c.get('session'))
      const { id } = c.req.valid('param')
      const archived = await archiveStack(id, userId)

      if (!archived) {
        return c.json(
          { error: { code: 'NOT_FOUND', message: 'Stack nicht gefunden.' } },
          404,
        )
      }

      return c.json({ archived: true })
    },
  )
  .post(
    '/:id/leaderboard',
    zValidator('param', stackIdParamSchema, validationErrorHook),
    zValidator('json', leaderboardEntrySchema, validationErrorHook),
    async (c) => {
      const { id } = c.req.valid('param')
      const entry = c.req.valid('json')
      const stack = await addLeaderboardEntry(id, entry)

      if (!stack) {
        return c.json(
          { error: { code: 'NOT_FOUND', message: 'Stack nicht gefunden.' } },
          404,
        )
      }

      return c.json(stack)
    },
  )
