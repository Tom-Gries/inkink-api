import { ObjectId, type WithId } from 'mongodb'
import { getDb } from '../../db'
import type { UserDto } from '../../schemas/user'

/**
 * Die „user"-Collection gehört Better Auth (Phase 3) und wird dort
 * verwaltet. Dieses Modul liest sie nur – solange kein Login erfolgt
 * ist, ist sie leer.
 */
interface UserDocument {
  _id?: ObjectId
  name?: string
  email?: string
  createdAt?: Date
}

const users = () => getDb().collection<UserDocument>('user')

function toDto(document: WithId<UserDocument>): UserDto {
  return {
    id: document._id.toHexString(),
    name: document.name ?? null,
    email: document.email ?? null,
  }
}

export async function listUsers(): Promise<UserDto[]> {
  const documents = await users().find().sort({ createdAt: -1 }).toArray()

  return documents.map(toDto)
}

export async function getUser(id: string): Promise<UserDto | null> {
  const document = await users().findOne({ _id: new ObjectId(id) })

  return document ? toDto(document) : null
}
