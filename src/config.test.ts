// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'

import { getTrustedOrigins } from './config.js'

const trustedOriginsBackup = process.env.TRUSTED_ORIGINS

afterEach(() => {
  if (trustedOriginsBackup === undefined) {
    delete process.env.TRUSTED_ORIGINS
  } else {
    process.env.TRUSTED_ORIGINS = trustedOriginsBackup
  }
})

describe('getTrustedOrigins', () => {
  it('liest mehrere Origins komma-separiert aus TRUSTED_ORIGINS', () => {
    process.env.TRUSTED_ORIGINS = 'http://localhost:3000,http://127.0.0.1:3000'

    expect(getTrustedOrigins()).toEqual([
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ])
  })

  it('entfernt Leerzeichen um einzelne Origins', () => {
    process.env.TRUSTED_ORIGINS = ' http://a.example , http://b.example '

    expect(getTrustedOrigins()).toEqual([
      'http://a.example',
      'http://b.example',
    ])
  })

  it('ignoriert leere Einträge', () => {
    process.env.TRUSTED_ORIGINS = 'http://a.example,, ,http://b.example'

    expect(getTrustedOrigins()).toEqual([
      'http://a.example',
      'http://b.example',
    ])
  })

  it('liefert ein leeres Array ohne gesetzte Variable', () => {
    delete process.env.TRUSTED_ORIGINS

    expect(getTrustedOrigins()).toEqual([])
  })
})
