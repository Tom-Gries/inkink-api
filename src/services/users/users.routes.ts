import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { validationErrorHook } from '../../hooks/validation.js'
import { userIdParamSchema } from '../../schemas/user.js'
import { getUser, listUsers } from './users.service.js'

export const usersRoutes = new Hono()

usersRoutes.get('/', async (c) => {
  return c.json(await listUsers())
})

usersRoutes.get(
  '/:id',
  zValidator('param', userIdParamSchema, validationErrorHook),
  async (c) => {
    const { id } = c.req.valid('param')
    const user = await getUser(id)

    if (!user) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'Benutzer nicht gefunden.' } },
        404,
      )
    }

    return c.json(user)
  },
)
