/**
 * Vertraute Origins für Auth (Better Auth `trustedOrigins`) und CORS –
 * konfiguriert über die Env-Variable `TRUSTED_ORIGINS` als komma-separierte
 * Liste, z. B.:
 *
 *   TRUSTED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
 *
 * Leerzeichen um einzelne Origins werden entfernt, leere Einträge ignoriert.
 * Ohne gesetzte Variable liefert die Funktion ein leeres Array:
 * - Better Auth vertraut dann automatisch nur der eigenen baseURL.
 * - CORS erlaubt keine Cross-Origin-Anfragen.
 *
 * Development, Staging und Production unterscheiden sich damit allein über
 * den Wert der Env-Variable – der Code bleibt unverändert.
 */
export function getTrustedOrigins(): string[] {
  return (
    process.env.TRUSTED_ORIGINS?.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean) ?? []
  )
}
