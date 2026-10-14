import 'dotenv/config'
import type { ObjectId } from 'mongodb'
import { getDb } from '../src/db.js'

/**
 * Repariert Stacks ohne `userId` (Legacy-Daten vor der Zugriffskontrolle
 * sowie anonym angelegte Stacks). Einmalige Migration, läuft lokal:
 *
 *   pnpm backfill:stacks           # Dry-run: nur Bericht, keine Änderungen
 *   pnpm backfill:stacks --apply   # schreibt die Änderungen wirklich
 *
 * Ablauf für jeden ungeclaimten Stack:
 *  1. Eindeutiger Match `creatorName` ↔ `profile.username` → `userId`
 *     setzen (Stack bleibt sonst unverändert, inkl. Sichtbarkeit).
 *  2. Kein (eindeutiges) Profil und `isPublic: false` → wieder öffentlich
 *     machen, damit der Besitzer den Stack im Editor sieht und per
 *     Claim (updateStack) dauerhaft übernehmen kann – statt unsichtbar
 *     verloren zu sein.
 */

interface StackDocument {
  _id: ObjectId
  creatorName: string
  isPublic?: boolean
}

interface ProfileDocument {
  _id: ObjectId
  userId: string
  username: string
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const db = getDb()
  const stacks = db.collection<StackDocument>('stacks')
  const profiles = db.collection<ProfileDocument>('profile')

  const unowned = await stacks
    .find({ userId: { $exists: false } })
    .toArray()

  let matched = 0
  let unprivated = 0
  let skipped = 0
  let ambiguous = 0

  for (const stack of unowned) {
    const idString = stack._id.toHexString()
    const candidates = (
      await profiles.find({ username: stack.creatorName }).toArray()
    ).filter((profile) => profile.userId.length > 0)

    if (candidates.length === 1) {
      const userId = candidates[0]?.userId as string
      if (apply) {
        await stacks.updateOne({ _id: stack._id }, { $set: { userId } })
      }
      matched += 1
      console.log(
        `[claim] Stack ${idString} („${stack.creatorName}") → Nutzer ${userId}`,
      )
      continue
    }

    if (candidates.length > 1) {
      ambiguous += 1
      console.log(
        `[ambiguous] Stack ${idString} („${stack.creatorName}") hat ${candidates.length} passende Profile – nicht zuordenbar.`,
      )
    }

    if (stack.isPublic === false) {
      if (apply) {
        await stacks.updateOne(
          { _id: stack._id },
          { $set: { isPublic: true } },
        )
      }
      unprivated += 1
      console.log(
        candidates.length === 1
          ? `[rescue] Stack ${idString} wird wieder öffentlich (Besitzer-Check offen).`
          : `[rescue] Stack ${idString} („${stack.creatorName}") hat keine eindeutige Zuordnung → wieder öffentlich.`,
      )
      continue
    }

    skipped += 1
    console.log(
      `[skip] Stack ${idString} („${stack.creatorName}") bleibt unverändert (öffentlich, keine Zuordnung).`,
    )
  }

  console.log(
    `\nFertig: ${unowned.length} ungeclaimte Stacks, ${matched} zugeordnet, ${unprivated} wieder öffentlich, ${skipped} unverändert, ${ambiguous} mehrdeutig.` +
      (apply
        ? ''
        : ' (Dry-run – mit `--apply` ausführen, um zu schreiben)'),
  )
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error('Backfill fehlgeschlagen:', error)
    process.exit(1)
  },
)