import { Cloud, Cpu, TriangleAlert } from 'lucide-react'
import { useMemo } from 'react'
import { PROVIDER_SPECS, isCloudProvider, providerSpec, type ProviderId } from '../../logic/providers'
import { useUiStore } from '../../store/uiStore'
import { useModelStore } from '../../store/modelStore'
import { apiKeyFor } from '../../types/settings'

/**
 * Local model, or a model in the cloud.
 *
 * Two states and then a choice, not one list of six. The user asked for a mode,
 * and the reason is that the two are not the same kind of thing: one is a program
 * on this machine, the other is somebody else's computer that your prompt goes to.
 * Burying that distinction in a dropdown of provider names is what made the
 * earlier version unreadable — the list did not say which kind of thing it was
 * offering.
 *
 * So: a two-way switch, and only when the answer is "cloud" does the second
 * control appear, because only then is there a provider to pick.
 */
export function ProviderPicker() {
  const appSettings = useUiStore((state) => state.appSettings)
  const provider = appSettings.provider
  const setAppSettings = useUiStore((state) => state.setAppSettings)
  const openDialog = useUiStore((state) => state.openDialog)
  const block = useUiStore((state) => state.providerBlock)
  const setModels = useModelStore((state) => state.setModels)
  const modelCount = useModelStore((state) => state.models.length)
  const cloud = isCloudProvider(provider)
  const spec = providerSpec(provider)

  const cloudProviders = useMemo(
    () => PROVIDER_SPECS.filter((entry) => isCloudProvider(entry.id)),
    [],
  )

  /**
   * Where the API button lands.
   *
   * With one cloud provider there was no question. With two, the button has to
   * pick something, and there are two ways to be wrong: always landing on the
   * first, which sends the user to a service they have no key for and then leaves
   * them staring at an empty model list; or remembering silently, which is a
   * hidden setting that surprises.
   *
   * So: **the one that already has a key.** That is the one the user can actually
   * use right now, and the rule is explainable in one sentence. With no key
   * anywhere, the first one, and the dropdown next to it makes switching one click.
   */
  const apiLanding = useMemo(() => {
    const withKey = cloudProviders.find((entry) => apiKeyFor(appSettings, entry.id) !== '')
    const fallback = cloudProviders[0]
    return withKey?.id ?? fallback?.id ?? 'lmstudio'
  }, [cloudProviders, appSettings])

  /**
   * Change of mode, or of provider.
   *
   * The list is emptied **here**, at the click, and not left to the re-check that
   * follows. The re-check clears it too, but it runs in an effect, so for one
   * frame the menu still shows the previous provider's models — and a model id
   * picked in that frame would be sent to a service that does not have it.
   *
   * La seconda ragione: la lista appartiene al provider, quindi mostrarla ancora
   * per un istante e una menzogna. Un menu vuoto con un motivo accanto e onesto.
   */
  const choose = (next: ProviderId): void => {
    if (next === provider) return
    setModels([])
    setAppSettings({ provider: next, defaultModel: null })
  }

  return (
    <div className="mode-switch">
      <div className="mode-switch-buttons" role="group" aria-label="Where the model runs">
        <button
          type="button"
          className={`mode-switch-option is-local ${!cloud ? 'is-on' : ''}`}
          aria-pressed={!cloud}
          onClick={() => choose('lmstudio')}
          title="A model on this machine. Prompts never leave it."
        >
          <Cpu size={12} />
          <span>Local</span>
        </button>
        <button
          type="button"
          className={`mode-switch-option is-api ${cloud ? 'is-on' : ''}`}
          aria-pressed={cloud}
          onClick={() => choose(apiLanding)}
          title={`A model on ${providerSpec(apiLanding).label}. Prompts are sent there. You can pick the other one next to this.`}
        >
          <Cloud size={12} />
          <span>API</span>
        </button>
      </div>

      {cloud ? (
        <select
          className="mode-switch-provider"
          value={provider}
          aria-label="Cloud provider"
          onChange={(event) => choose(event.currentTarget.value as ProviderId)}
        >
          {cloudProviders.map((entry) => (
            <option key={entry.id} value={entry.id} title={entry.blurb}>
              {entry.label}
            </option>
          ))}
        </select>
      ) : null}

      {/*
        The one thing that must not need reading: with an API selected, prompts
        leave this machine. It sits next to the switch for that reason, and it is
        the only warning, because a warning that needs to be found is not one.
      */}
      {cloud ? <span className="mode-switch-warn">prompts leave this computer</span> : null}

      {/*
        Why there are no models. Without this the dropdown is simply empty, which
        looks like a bug and is the single most confusing thing this switch can do.
      */}
      {cloud && block ? (
        <button
          type="button"
          className="mode-switch-block"
          onClick={() =>
            openDialog('settings', 'connection')
          }
        >
          <TriangleAlert size={11} />
          <span>{block.message}</span>
          {block.action === 'start-service' ? <em>start the local service</em> : null}
        </button>
      ) : null}

      {/*
        Ready, and worth saying so: a cloud provider that answered is the case the
        user cannot otherwise tell apart from "still loading".
      */}
      {cloud && !block && modelCount > 0 ? (
        <span className="mode-switch-ok">{modelCount} models available</span>
      ) : null}

      <span className="visually-hidden">{spec.blurb}</span>
    </div>
  )
}
