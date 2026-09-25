import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { validationErrorHook } from '../../hooks/validation'
import {
  leaderboardEntrySchema,
  stackIdParamSchema,
  stackInputSchema,
} from '../../schemas/stack'
import {
  addLeaderboardEntry,
  archiveStack,
  createStack,
  getStack,
  listStacks,
  updateStack,
} from './stacks.service'

export const stacksRoutes = new Hono()
  .get('/', async (c) => {
    return c.json(await listStacks())
  })
  .get(
    '/:id',
    zValidator('param', stackIdParamSchema, validationErrorHook),
    async (c) => {
      const { id } = c.req.valid('param')
      const stack = await getStack(id)

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
    zValidator('json', stackInputSchema, validationErrorHook),
    async (c) => {
      const input = c.req.valid('json')
      return c.json(await createStack(input), 201)
    },
  )
  .put(
    '/:id',
    zValidator('param', stackIdParamSchema, validationErrorHook),
    zValidator('json', stackInputSchema, validationErrorHook),
    async (c) => {
      const { id } = c.req.valid('param')
      const input = c.req.valid('json')
      const stack = await updateStack(id, input)

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
    zValidator('param', stackIdParamSchema, validationErrorHook),
    async (c) => {
      const { id } = c.req.valid('param')
      const archived = await archiveStack(id)

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
