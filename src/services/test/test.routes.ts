import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { validationErrorHook } from '../../hooks/validation'
import { createTestMessageSchema, testIdParamSchema } from '../../schemas/test'
import {
  createTestMessage,
  deleteTestMessage,
  getTestMessage,
  listTestMessages,
} from './test.service'

export const testRoutes = new Hono()
  .post(
    '/',
    zValidator('json', createTestMessageSchema, validationErrorHook),
    async (c) => {
      const { message } = c.req.valid('json')
      const testMessage = await createTestMessage({ message })

      return c.json(testMessage, 201)
    },
  )
  .get('/', async (c) => {
    return c.json(await listTestMessages())
  })
  .get(
    '/:id',
    zValidator('param', testIdParamSchema, validationErrorHook),
    async (c) => {
      const { id } = c.req.valid('param')
      const testMessage = await getTestMessage(id)

      if (!testMessage) {
        return c.json(
          {
            error: {
              code: 'NOT_FOUND',
              message: 'Test-Nachricht nicht gefunden.',
            },
          },
          404,
        )
      }

      return c.json(testMessage)
    },
  )
  .delete(
    '/:id',
    zValidator('param', testIdParamSchema, validationErrorHook),
    async (c) => {
      const { id } = c.req.valid('param')
      const deleted = await deleteTestMessage(id)

      if (!deleted) {
        return c.json(
          {
            error: {
              code: 'NOT_FOUND',
              message: 'Test-Nachricht nicht gefunden.',
            },
          },
          404,
        )
      }

      return c.body(null, 204)
    },
  )
