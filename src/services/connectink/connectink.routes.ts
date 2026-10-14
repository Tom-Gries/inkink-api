import { zValidator } from '@hono/zod-validator'
import { type Context, Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { type AuthVariables, sessionMiddleware } from '../../hooks/auth.js'
import { validationErrorHook } from '../../hooks/validation.js'
import {
  connectionIdParamSchema,
  connectRequestInputSchema,
  searchUsersQuerySchema,
} from '../../schemas/connectink.js'
import {
  ConnectError,
  listConnections,
  listRequests,
  removeConnection,
  resolveRequest,
  searchUsers,
  sendRequest,
} from './connectink.service.js'

export const connectinkRoutes = new Hono<{ Variables: AuthVariables }>()

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
 * Führt eine Aktion aus und übersetzt ConnectError in das einheitliche
 * Fehlerformat `{ error: { code, message } }`. Andere Fehler propagieren
 * an den globalen Error-Handler.
 */
async function runAction(
  c: Context,
  action: () => Promise<Response>,
): Promise<Response> {
  try {
    return await action()
  } catch (error) {
    if (error instanceof ConnectError) {
      return c.json(
        { error: { code: error.code, message: error.message } },
        error.status,
      )
    }
    throw error
  }
}

connectinkRoutes.get(
  '/users',
  sessionMiddleware,
  zValidator('query', searchUsersQuerySchema, validationErrorHook),
  (c) =>
    runAction(c, async () => {
      const userId = requireUserId(c.get('session'))
      const { q } = c.req.valid('query')
      return c.json({ users: await searchUsers(userId, q ?? '') })
    }),
)

connectinkRoutes.get('/requests', sessionMiddleware, (c) =>
  runAction(c, async () => {
    const userId = requireUserId(c.get('session'))
    return c.json(await listRequests(userId))
  }),
)

connectinkRoutes.post(
  '/requests',
  sessionMiddleware,
  zValidator('json', connectRequestInputSchema, validationErrorHook),
  (c) =>
    runAction(c, async () => {
      const userId = requireUserId(c.get('session'))
      const { toUserId } = c.req.valid('json')
      return c.json(await sendRequest(userId, toUserId), 201)
    }),
)

connectinkRoutes.post(
  '/requests/:id/accept',
  sessionMiddleware,
  zValidator('param', connectionIdParamSchema, validationErrorHook),
  (c) =>
    runAction(c, async () => {
      const userId = requireUserId(c.get('session'))
      const { id } = c.req.valid('param')
      return c.json(await resolveRequest(userId, id, 'accept'))
    }),
)

connectinkRoutes.post(
  '/requests/:id/reject',
  sessionMiddleware,
  zValidator('param', connectionIdParamSchema, validationErrorHook),
  (c) =>
    runAction(c, async () => {
      const userId = requireUserId(c.get('session'))
      const { id } = c.req.valid('param')
      return c.json(await resolveRequest(userId, id, 'reject'))
    }),
)

connectinkRoutes.post(
  '/requests/:id/ignore',
  sessionMiddleware,
  zValidator('param', connectionIdParamSchema, validationErrorHook),
  (c) =>
    runAction(c, async () => {
      const userId = requireUserId(c.get('session'))
      const { id } = c.req.valid('param')
      return c.json(await resolveRequest(userId, id, 'ignore'))
    }),
)

connectinkRoutes.get('/connections', sessionMiddleware, (c) =>
  runAction(c, async () => {
    const userId = requireUserId(c.get('session'))
    return c.json({ connections: await listConnections(userId) })
  }),
)

connectinkRoutes.delete(
  '/connections/:id',
  sessionMiddleware,
  zValidator('param', connectionIdParamSchema, validationErrorHook),
  (c) =>
    runAction(c, async () => {
      const userId = requireUserId(c.get('session'))
      const { id } = c.req.valid('param')
      await removeConnection(userId, id)
      return c.body(null, 204)
    }),
)
