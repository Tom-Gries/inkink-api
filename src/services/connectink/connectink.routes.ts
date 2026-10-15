import { zValidator } from '@hono/zod-validator'
import { type Context, Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { type AuthVariables, sessionMiddleware } from '../../hooks/auth.js'
import { validationErrorHook } from '../../hooks/validation.js'
import {
  connectionIdParamSchema,
  connectRequestInputSchema,
  createGroupSchema,
  groupIdParamSchema,
  groupUserIdParamSchema,
  groupUserInputSchema,
  searchUsersQuerySchema,
  updateGroupSchema,
} from '../../schemas/connectink.js'
import { listGroupStacks } from '../stacks/stacks.service.js'
import {
  addGroupMember,
  ConnectError,
  createGroup,
  deleteGroup,
  listConnections,
  listGroupInvitations,
  listGroups,
  listRequests,
  removeConnection,
  removeGroupAdmin,
  removeGroupMember,
  resolveGroupInvitation,
  resolveRequest,
  searchUsers,
  sendRequest,
  setGroupAdmin,
  updateGroup,
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
connectinkRoutes.get('/groups', sessionMiddleware, (c) =>
  runAction(c, async () => {
    const userId = requireUserId(c.get('session'))
    return c.json({ groups: await listGroups(userId) })
  }),
)

connectinkRoutes.post(
  '/groups',
  sessionMiddleware,
  zValidator('json', createGroupSchema, validationErrorHook),
  (c) =>
    runAction(c, async () => {
      const userId = requireUserId(c.get('session'))
      const { name } = c.req.valid('json')
      return c.json(await createGroup(userId, name), 201)
    }),
)

connectinkRoutes.patch(
  '/groups/:id',
  sessionMiddleware,
  zValidator('param', groupIdParamSchema, validationErrorHook),
  zValidator('json', updateGroupSchema, validationErrorHook),
  (c) =>
    runAction(c, async () => {
      const userId = requireUserId(c.get('session'))
      const { id } = c.req.valid('param')
      const input = c.req.valid('json')
      return c.json(await updateGroup(userId, id, input))
    }),
)

connectinkRoutes.delete(
  '/groups/:id',
  sessionMiddleware,
  zValidator('param', groupIdParamSchema, validationErrorHook),
  (c) =>
    runAction(c, async () => {
      const userId = requireUserId(c.get('session'))
      const { id } = c.req.valid('param')
      await deleteGroup(userId, id)
      return c.body(null, 204)
    }),
)

connectinkRoutes.post(
  '/groups/:id/members',
  sessionMiddleware,
  zValidator('param', groupIdParamSchema, validationErrorHook),
  zValidator('json', groupUserInputSchema, validationErrorHook),
  (c) =>
    runAction(c, async () => {
      const userId = requireUserId(c.get('session'))
      const { id } = c.req.valid('param')
      const { userId: targetUserId } = c.req.valid('json')
      return c.json(await addGroupMember(userId, id, targetUserId))
    }),
)

connectinkRoutes.delete(
  '/groups/:id/members/:userId',
  sessionMiddleware,
  zValidator('param', groupUserIdParamSchema, validationErrorHook),
  (c) =>
    runAction(c, async () => {
      const userId = requireUserId(c.get('session'))
      const { id, userId: targetUserId } = c.req.valid('param')
      return c.json(await removeGroupMember(userId, id, targetUserId))
    }),
)

connectinkRoutes.post(
  '/groups/:id/admins',
  sessionMiddleware,
  zValidator('param', groupIdParamSchema, validationErrorHook),
  zValidator('json', groupUserInputSchema, validationErrorHook),
  (c) =>
    runAction(c, async () => {
      const userId = requireUserId(c.get('session'))
      const { id } = c.req.valid('param')
      const { userId: targetUserId } = c.req.valid('json')
      return c.json(await setGroupAdmin(userId, id, targetUserId))
    }),
)

connectinkRoutes.delete(
  '/groups/:id/admins/:userId',
  sessionMiddleware,
  zValidator('param', groupUserIdParamSchema, validationErrorHook),
  (c) =>
    runAction(c, async () => {
      const userId = requireUserId(c.get('session'))
      const { id, userId: targetUserId } = c.req.valid('param')
      return c.json(await removeGroupAdmin(userId, id, targetUserId))
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
connectinkRoutes.get('/groups/invitations', sessionMiddleware, (c) =>
  runAction(c, async () => {
    const userId = requireUserId(c.get('session'))
    return c.json({ invitations: await listGroupInvitations(userId) })
  }),
)

connectinkRoutes.post(
  '/groups/invitations/:id/accept',
  sessionMiddleware,
  zValidator('param', groupIdParamSchema, validationErrorHook),
  (c) =>
    runAction(c, async () => {
      const userId = requireUserId(c.get('session'))
      const { id: groupId } = c.req.valid('param')
      return c.json(await resolveGroupInvitation(userId, groupId, 'accept'))
    }),
)

connectinkRoutes.post(
  '/groups/invitations/:id/reject',
  sessionMiddleware,
  zValidator('param', groupIdParamSchema, validationErrorHook),
  (c) =>
    runAction(c, async () => {
      const userId = requireUserId(c.get('session'))
      const { id: groupId } = c.req.valid('param')
      return c.json(await resolveGroupInvitation(userId, groupId, 'reject'))
    }),
)

connectinkRoutes.post(
  '/groups/invitations/:id/ignore',
  sessionMiddleware,
  zValidator('param', groupIdParamSchema, validationErrorHook),
  (c) =>
    runAction(c, async () => {
      const userId = requireUserId(c.get('session'))
      const { id: groupId } = c.req.valid('param')
      return c.json(await resolveGroupInvitation(userId, groupId, 'ignore'))
    }),
)

connectinkRoutes.get(
  '/groups/:id/stacks',
  sessionMiddleware,
  zValidator('param', groupIdParamSchema, validationErrorHook),
  (c) =>
    runAction(c, async () => {
      const userId = requireUserId(c.get('session'))
      const { id: groupId } = c.req.valid('param')
      return c.json({ stacks: await listGroupStacks(userId, groupId) })
    }),
)
