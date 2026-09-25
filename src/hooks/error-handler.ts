import type { ErrorHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'

const statusCodes: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE_ENTITY',
  500: 'INTERNAL_SERVER_ERROR',
  503: 'SERVICE_UNAVAILABLE',
}

/**
 * Globale Fehlerbehandlung: alle Fehler verlassen die API in einem
 * einheitlichen Format `{ error: { code, message } }`.
 */
export const errorHandler: ErrorHandler = (error, c) => {
  if (error instanceof HTTPException) {
    return c.json(
      {
        error: {
          code: statusCodes[error.status] ?? 'HTTP_ERROR',
          message: error.message || 'Anfrage fehlgeschlagen.',
        },
      },
      error.status,
    )
  }

  if (error instanceof Error && error.message.includes('MONGODB_URI')) {
    return c.json(
      {
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Datenbank ist nicht konfiguriert oder nicht erreichbar.',
        },
      },
      503,
    )
  }

  console.error(error)

  return c.json(
    {
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Unerwarteter Serverfehler.',
      },
    },
    500,
  )
}
