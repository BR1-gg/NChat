import {
  ArrowDown,
  ArrowUp,
  ChevronsUp,
  CirclePause,
  CirclePlay,
  CornerDownRight,
  Trash2,
  X,
} from 'lucide-react'
import type { WorkspaceMeta } from '../../persistence/db'
import { isCloudProvider } from '../../logic/providers'
import { navigate } from '../../router'
import { useQueueStore } from '../../queue/queueStore'
import {
  cancelJob,
  clearQueue,
  formatDuration,
  moveJob,
  pauseQueue,
  queueEtaMs,
  queuePosition,
  resumeQueue,
} from '../../queue/runQueue'
import { useRunStore } from '../../store/runStore'
import { useTabsStore } from '../../store/tabsStore'
import { useUiStore } from '../../store/uiStore'
import { Button, IconButton } from '../common/Button'
import { Select } from '../common/FormControls'

function jobAge(enqueuedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - enqueuedAt) / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.round(seconds / 60)}m`
}

export function QueuePanel() {
  const open = useUiStore((state) => state.queuePanelOpen)
  const setOpen = useUiStore((state) => state.setQueuePanelOpen)
  const jobs = useQueueStore((state) => state.jobs)
  const paused = useQueueStore((state) => state.paused)
  const pauseReason = useQueueStore((state) => state.pauseReason)
  const concurrency = useUiStore((state) => state.appSettings.queueConcurrency)
  const provider = useUiStore((state) => state.appSettings.provider)
  const running = useRunStore((state) => Object.keys(state.runs).length)
  const eta = queueEtaMs()
  const now = Date.now()

  if (!open) return null

  const goToNode = (workspaceId: string): void => {
    useTabsStore.getState().openTab(workspaceId)
    navigate({ name: 'workspace', workspaceId })
  }

  const workspaceName = (id: string): string => {
    const cached = getWorkspaceName(id)
    return cached ?? id.slice(0, 6)
  }

  const pending = jobs.filter(
    (job) => job.state === 'waiting' || job.state === 'blocked' || job.state === 'running',
  )

  return (
    <aside className="queue-panel" aria-label="Generation queue">
      <header>
        <div>
          <strong>Queue</strong>
          <span className="inspector-value">
            {pending.filter((job) => job.state === 'running').length} running ·{' '}
            {pending.filter((job) => job.state !== 'running').length} queued
            {eta ? ` · ~${formatDuration(eta)} left` : ''}
          </span>
        </div>
        <IconButton label="Close queue panel" onClick={() => setOpen(false)}>
          <X size={13} />
        </IconButton>
      </header>

      <div className="queue-toolbar">
        <Button
          size="small"
          icon={paused ? <CirclePlay size={11} /> : <CirclePause size={11} />}
          onClick={() => (paused ? resumeQueue() : pauseQueue('Paused by you'))}
        >
          {paused ? 'Resume' : 'Pause'}
        </Button>
        <Button size="small" onClick={clearQueue}>
          Clear queue
        </Button>
        <label className="queue-concurrency">
          <span>Slots</span>
          <Select
            value={String(concurrency)}
            aria-label="Queue concurrency"
            onChange={(event) =>
              useUiStore
                .getState()
                .setAppSettings({ queueConcurrency: Number(event.currentTarget.value) || 1 })
            }
          >
            {[1, 2, 3, 4].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {concurrency > 1 ? (
        <p className="queue-note">
          {isCloudProvider(provider)
            ? 'A provider in cloud handles its own concurrency; more than one slot helps only if the service allows it.'
            : 'LM Studio serializes requests on a single model; more than one slot only helps with parallel slots.'}
        </p>
      ) : null}
      {paused && pauseReason ? <div className="inline-message warning">{pauseReason}</div> : null}

      <div className="queue-list">
        {jobs.length === 0 ? <span className="empty-usage">The queue is empty.</span> : null}
        {jobs.map((job) => (
          <div key={job.id} className={`queue-job state-${job.state}`}>
            <span className="queue-index">{queuePosition(job.id) || '·'}</span>
            <div className="queue-job-copy">
              <strong title={job.title}>{job.title}</strong>
              <span>
                {workspaceName(job.workspaceId)} · {job.state} · {jobAge(job.enqueuedAt, now)}
                {job.dependsOn.length > 0 ? ` · waits for ${job.dependsOn.length}` : ''}
              </span>
              {job.errorMessage ? <span className="queue-error">{job.errorMessage}</span> : null}
            </div>
            {job.state === 'waiting' || job.state === 'blocked' ? (
              <>
                <IconButton
                  label="Cancel queued job"
                  onClick={() => cancelJob(job.id)}
                >
                  <X size={11} />
                </IconButton>
                <IconButton label="Move to top" onClick={() => moveJob(job.id, 'top')}>
                  <ChevronsUp size={11} />
                </IconButton>
                <IconButton label="Move up" onClick={() => moveJob(job.id, 'up')}>
                  <ArrowUp size={11} />
                </IconButton>
                <IconButton label="Move down" onClick={() => moveJob(job.id, 'down')}>
                  <ArrowDown size={11} />
                </IconButton>
              </>
            ) : null}
            <IconButton
              label="Go to node"
              onClick={() => goToNode(job.workspaceId)}
            >
              <CornerDownRight size={11} />
            </IconButton>
          </div>
        ))}
      </div>

      <footer>
        {running > 0
          ? `${running} active generation${running === 1 ? '' : 's'}`
          : 'Idle'}
        {running > 0 ? (
          <Trash2 size={10} aria-hidden className="queue-footer-icon" />
        ) : null}
      </footer>
    </aside>
  )
}

const nameCache = new Map<string, string>()

export function primeWorkspaceNames(list: WorkspaceMeta[]): void {
  for (const meta of list) nameCache.set(meta.id, meta.name)
}

function getWorkspaceName(id: string): string | undefined {
  return nameCache.get(id)
}
