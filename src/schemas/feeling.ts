import { z } from 'zod'

/**
 * Feste Menge an Gefühls-IDs für Feelink. Die Web-Seite spiegelt diese
 * Liste (web/src/inks/feelink/constants.ts) – die Werte müssen übereinstimmen.
 */
export const feelingMoodSchema = z.enum([
  'happy',
  'sad',
  'angry',
  'calm',
  'tired',
  'anxious',
  'excited',
  'grateful',
])

/**
 * Mehrere Gefühle pro Eintrag sind erlaubt – mindestens eines, ohne Obergrenze.
 * Duplikate werden über ein Refinement ausgeschlossen.
 */
export const feelingMoodsSchema = z
  .array(feelingMoodSchema)
  .min(1, 'Mindestens ein Gefühl ist erforderlich.')
  .refine((moods) => new Set(moods).size === moods.length, {
    message: 'Gefühle dürfen nicht doppelt gewählt werden.',
  })

export const feelingInputSchema = z.object({
  moods: feelingMoodsSchema,
  // Notiz ist optional – fehlend/leer ist erlaubt, wird auf '' normalisiert.
  note: z
    .string()
    .trim()
    .max(280, 'Notiz darf maximal 280 Zeichen lang sein.')
    .default(''),
})

export const feelingIdParamSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Ungültige Gefühls-Eintrags-ID.'),
})

export type FeelingMood = z.infer<typeof feelingMoodSchema>
export type FeelingMoods = z.infer<typeof feelingMoodsSchema>
export type FeelingInput = z.infer<typeof feelingInputSchema>

/** Gefühls-Eintrag-DTO, wie die API ihn ausliefert. */
export interface FeelingDto {
  id: string
  moods: FeelingMood[]
  note: string
  createdAt: string
}
