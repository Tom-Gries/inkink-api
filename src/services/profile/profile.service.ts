import { getDb } from '../../db'
import type { ProfileDto } from '../../schemas/profile'

/**
 * App-eigene Profil-Collection (unabhängig von Better Auth).
 * Ein Dokument pro Nutzer, verknüpft über die Better-Auth-`user`-ID.
 */
interface ProfileDocument {
  userId: string
  username: string | null
}

const profiles = () => getDb().collection<ProfileDocument>('profile')

/**
 * Legt bei Bedarf den userId-Index an (ein Profil pro Nutzer).
 * Wird beim ersten Profilzugriff ausgeführt (idempotent) – so bleibt
 * die API ohne Skript sinterbar. Hinweis: Der Benutzername ist bewusst
 * NICHT unique – mehrere Nutzer dürfen denselben Namen verwenden.
 */
async function ensureIndexes(): Promise<void> {
  await profiles().createIndex({ userId: 1 }, { unique: true })
}

function toDto(document: ProfileDocument): ProfileDto {
  return {
    userId: document.userId,
    username: document.username,
  }
}

export async function getProfile(userId: string): Promise<ProfileDto | null> {
  await ensureIndexes()

  const document = await profiles().findOne({ userId })

  return document ? toDto(document) : null
}

/**
 * Setzt (oder überschreibt) den Benutzernamen eines Profils.
 * Erzeugt das Profil bei Bedarf (Upsert).
 */
export async function setUsername(
  userId: string,
  username: string,
): Promise<ProfileDto> {
  await ensureIndexes()

  await profiles().updateOne(
    { userId },
    { $set: { username } },
    { upsert: true },
  )

  return { userId, username }
}
