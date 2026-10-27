import { beforeEach, describe, expect, it } from 'vitest'
import {
  initialInstallState,
  installLabel,
  isInstallableState,
  isRunningInstalled,
  type InstallState,
} from './install'

/**
 * `beforeinstallprompt` only exists in Chromium, so every user-visible decision
 * is derived from a state the browser reports.
 *
 * Il caso che questi test presidiano e uno solo, ed e recente: l'app offriva di
 * installarsi da sola, e l'utente ha finito con **due icone sul Desktop**, una delle
 * quali non funzionava. Quindi la regola e che il controllo non compare mai — e il
 * perche e in `installLabel`, accanto alla decisione.
 */
describe('install state', () => {
  it('non offre mai di installarsi, in nessuno stato', () => {
    for (const stato of ['unsupported', 'dismissed', 'ready', 'accepted', 'declined'] as const) {
      expect(installLabel(stato), stato).toBeNull()
    }
  })

  it('il pulsante non viene renderizzato nemmeno quando il browser lo permetterebbe', () => {
    // Il caso in cui compariva: il browser accetta l'installazione, quindi lo stato
    // e `ready` e il pulsante esce. Ora non deve uscire in nessun caso.
    expect(installLabel('ready')).toBeNull()
    expect(installLabel('declined')).toBeNull()
  })

  it('sa ancora dire se e gia installato, per non confondere i due casi', () => {
    // La domanda «sono dentro una finestra installata?» resta vera e utile: e cio
    // che distingue il launcher da una scorciatoia di Edge. Non va rimossa insieme al
    // pulsante, altrimenti si perde anche il controllo.
    expect(isRunningInstalled()).toBe(false)
    expect(isInstallableState('ready')).toBe(true)
    expect(isInstallableState('accepted')).toBe(false)
  })
})

describe('every state has a defined label', () => {
  const states: InstallState[] = ['unsupported', 'dismissed', 'ready', 'accepted', 'declined']
  beforeEach(() => undefined)
  it('never returns undefined', () => {
    for (const state of states) expect(installLabel(state)).not.toBeUndefined()
  })
  it('starts from a state that is safe to render', () => {
    const start = initialInstallState()
    expect(states).toContain(start)
  })
})
