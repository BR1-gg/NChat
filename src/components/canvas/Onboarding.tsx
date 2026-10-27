import { Check, ExternalLink, Network, Play, PlugZap } from 'lucide-react'
import { isCloudProvider, providerSpec } from '../../logic/providers'
import { useUiStore } from '../../store/uiStore'
import { Button } from '../common/Button'

export function Onboarding({ onTestConnection }: { onTestConnection: () => void }) {
  const nodeCount = useUiStore((state) => state.models.length)
  const status = useUiStore((state) => state.connectionStatus)
  const provider = useUiStore((state) => state.appSettings.provider)
  const connected = status === 'connected' || status === 'no-model'
  /*
   * I due primi passi riguardano il provider scelto, non sempre LM Studio.
   *
   * La versione precedente diceva «NCHAT talks only to your local LM Studio server.
   * Nothing leaves this browser» e i passi 1 e 2 erano su LM Studio, **anche con un
   * provider cloud selezionato**: uno schermo di primo avvio che chiedeva di aprire
   * un programma irrelevante e prometteva una riservatezza che in quel momento non
   * era vera. E il peggiore dei due: la promessa di privacy su una configurazione
   * che manda i prompt fuori.
   */
  const cloud = isCloudProvider(provider)
  const spec = providerSpec(provider)
  const steps = cloud
    ? [
        'Add your API key in Settings → Connection.',
        'Start the local service from the tray icon, then pick a model.',
      ]
    : [
        'Open LM Studio and load any chat model.',
        'Start the local server. The default is localhost:1234.',
      ]
  return (
    <section className="onboarding" aria-labelledby="onboarding-title">
      <div className="onboarding-mark">
        <Network size={22} />
      </div>
      <h1 id="onboarding-title">3 steps to your first answer</h1>
      <p>
        {cloud
          ? `Prompts go to ${spec.label}. The key is held by the local service in memory, never on disk.`
          : 'NCHAT talks only to your local LM Studio server. Nothing leaves this browser.'}
      </p>
      <div className="onboarding-steps">
        <div className={`onboarding-step ${connected ? 'done' : ''}`}>
          <span className="onboarding-step-number">{connected ? <Check size={12} /> : '1'}</span>
          <span>{steps[0]}</span>
        </div>
        <div className={`onboarding-step ${connected ? 'done' : ''}`}>
          <span className="onboarding-step-number">{connected ? <Check size={12} /> : '2'}</span>
          <span>{steps[1]}</span>
        </div>
        <div className="onboarding-step">
          <span className="onboarding-step-number">3</span>
          <span>Add a Prompt, type your question, then press Ctrl+Enter.</span>
        </div>
      </div>
      <div className="onboarding-actions">
        <Button
          variant="primary"
          icon={<PlugZap size={12} />}
          onClick={onTestConnection}
        >
          Test connection
        </Button>
        <Button icon={<Play size={11} />} onClick={() => useUiStore.getState().openPalette()}>
          Add a prompt
        </Button>
        {cloud ? (
          <Button onClick={() => useUiStore.getState().openDialog('settings', 'connection')}>
            Open connection settings
          </Button>
        ) : (
          <a
            className="btn"
            href="https://lmstudio.ai/docs"
            target="_blank"
            rel="noreferrer"
          >
            Docs <ExternalLink size={11} />
          </a>
        )}
      </div>
      {nodeCount > 0 ? <small style={{ color: 'var(--ok)' }}>{nodeCount} models available</small> : null}
    </section>
  )
}
