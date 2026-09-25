import { z } from 'zod'

export const appearanceSchema = z.enum([
  'learn',
  'proof',
  'learn & proof',
  'inactive',
])

export const questionTypeSchema = z.enum(['open', 'closed'])

/** Bewertungsmodus geschlossener Fragen mit mehreren richtigen Antworten. */
export const scoringSchema = z.enum(['all', 'partial'])

export const answerOptionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  correct: z.boolean(),
})

export const questionSchema = z
  .object({
    id: z.string().min(1),
    type: questionTypeSchema,
    appearance: appearanceSchema,
    question: z.string().min(1),
    explanation: z.string().default(''),
    points: z.number().int().min(0).default(1),
    scoring: scoringSchema.default('all'),
    answerOptions: z.array(answerOptionSchema).default([]),
  })
  .superRefine((data, ctx) => {
    if (data.type === 'closed') {
      if (data.answerOptions.length < 2) {
        ctx.addIssue({
          code: 'custom',
          path: ['answerOptions'],
          message:
            'Eine geschlossene Frage braucht mindestens zwei Antwortmöglichkeiten.',
        })
      }
      if (!data.answerOptions.some((option) => option.correct)) {
        ctx.addIssue({
          code: 'custom',
          path: ['answerOptions'],
          message: 'Mindestens eine Antwortmöglichkeit muss korrekt sein.',
        })
      }
      const ids = data.answerOptions.map((option) => option.id)
      if (new Set(ids).size !== ids.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['answerOptions'],
          message: 'Antwortmöglichkeiten müssen eindeutige IDs haben.',
        })
      }
    }
    if (data.type === 'open' && data.answerOptions.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['answerOptions'],
        message: 'Eine offene Frage besitzt keine Antwortmöglichkeiten.',
      })
    }
  })

export const stackInputSchema = z.object({
  name: z.string().trim().min(1, 'Name ist erforderlich.').max(120),
  creatorName: z
    .string()
    .trim()
    .min(1, 'Creatorname ist erforderlich.')
    .max(80),
  examTime: z
    .number()
    .int()
    .min(1)
    .max(24 * 60 * 60),
  passingScore: z.number().int().min(0).default(0),
  questions: z.array(questionSchema).default([]),
})

export const stackIdParamSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Ungültige Stack-ID.'),
})

export const leaderboardEntrySchema = z.object({
  name: z.string().trim().min(1, 'Name ist erforderlich.').max(80),
  score: z.number().int().min(0),
  time: z.number().int().min(0),
})

export type Appearance = z.infer<typeof appearanceSchema>
export type QuestionType = z.infer<typeof questionTypeSchema>
export type Scoring = z.infer<typeof scoringSchema>
export type AnswerOption = z.infer<typeof answerOptionSchema>
export type Question = z.infer<typeof questionSchema>
export type StackInput = z.infer<typeof stackInputSchema>
export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>

/** Stack-DTO, wie die API ihn ausliefert. */
export interface StackDto {
  id: string
  name: string
  creatorName: string
  examTime: number
  /** Ab dieser Punktzahl gilt die Prüfung als bestanden (0 = keine Schwelle). */
  passingScore: number
  archived: boolean
  questions: Question[]
  leaderboard: LeaderboardEntry[]
}
