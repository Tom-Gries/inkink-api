import type { Context } from 'hono'

interface ValidationFailure {
  success: false
  error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> }
}

type ValidationResult = { success: true; data: unknown } | ValidationFailure

/**
 * Gemeinsamer Hook für zValidator: Validierungsfehler verlassen die API
 * im einheitlichen Fehlerformat mit Details zu den betroffenen Feldern.
 */
export function validationErrorHook(
  result: ValidationResult,
  c: Context,
): Response | undefined {
  if (!result.success) {
    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Eingabe ist ungültig.',
          issues: result.error.issues.map((issue) => ({
            path: issue.path.map(String).join('.'),
            message: issue.message,
          })),
        },
      },
      400,
    )
  }
}
