import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { type AuthVariables, sessionMiddleware } from '../../hooks/auth.js'
import { validationErrorHook } from '../../hooks/validation.js'
import {
  feelingIdParamSchema,
  feelingInputSchema,
} from '../../schemas/feeling.js'
import {
  createFeeling,
  deleteFeeling,
  listFeelings,
} from './feelings.service.js'

export const feelingsRoutes = new Hono<{ Variables: AuthVariables }>()

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

feelingsRoutes.get('/', sessionMiddleware, async (c) => {
  const userId = requireUserId(c.get('session'))

  return c.json(await listFeelings(userId))
})

feelingsRoutes.post(
  '/',
  sessionMiddleware,
  zValidator('json', feelingInputSchema, validationErrorHook),
  async (c) => {
    const userId = requireUserId(c.get('session'))
    const input = c.req.valid('json')

    return c.json(await createFeeling(userId, input), 201)
  },
)

feelingsRoutes.delete(
  '/:id',
  sessionMiddleware,
  zValidator('param', feelingIdParamSchema, validationErrorHook),
  async (c) => {
    const userId = requireUserId(c.get('session'))
    const { id } = c.req.valid('param')
    const deleted = await deleteFeeling(userId, id)

    if (!deleted) {
      return c.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: 'Gefühls-Eintrag nicht gefunden.',
          },
        },
        404,
      )
    }

    return c.body(null, 204)
  },
)
