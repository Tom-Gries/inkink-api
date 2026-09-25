// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { getDb } from './db'

const mongoUriBackup = process.env.MONGODB_URI

afterEach(() => {
  if (mongoUriBackup === undefined) {
    delete process.env.MONGODB_URI
  } else {
    process.env.MONGODB_URI = mongoUriBackup
  }
})

describe('getDb', () => {
  it('wirft ohne MONGODB_URI eine verständliche Fehlermeldung', () => {
    delete process.env.MONGODB_URI

    expect(() => getDb()).toThrowError(/MONGODB_URI ist nicht gesetzt/)
  })
})
