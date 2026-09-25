import { createMiddleware } from 'hono/factory'
import { getAuth } from '../auth'

export type Session = Awaited<
  ReturnType<ReturnType<typeof getAuth>['api']['getSession']>
>

export interface AuthVariables {
  session: Session | null
}

/** Stellt die aktuelle Session aus dem Cookie in c.get('session') bereit. */
export const sessionMiddleware = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    console.log(
      `[auth:server] sessionMiddleware: Session-Check für ${c.req.method} ${c.req.url}`,
    )

    try {
      const session = await getAuth().api.getSession({
        headers: c.req.raw.headers,
      })

      if (session?.user) {
        console.log(
          `[auth:server] sessionMiddleware: Session gültig (user=${session.user.id})`,
        )
      } else {
        console.log(
          '[auth:server] sessionMiddleware: Keine gültige Session → session=null',
        )
      }

      c.set('session', session)
    } catch (error) {
      console.error(
        '[auth:server] sessionMiddleware: getSession() warf einen Fehler',
        error,
      )
      throw error
    }

    await next()
  },
)
