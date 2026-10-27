import { useNodes, ViewportPortal } from '@xyflow/react'
import { useMemo } from 'react'
import { getActiveWorkspaceStore, useWorkspace } from '../../store/workspaceStore'

const PADDING = 26

interface GroupDescriptor {
  id: string
  color: string
  memberIds: string[]
}

interface Frame {
  id: string
  color: string
  x: number
  y: number
  width: number
  height: number
}

/**
 * Dashed frames for the **legacy** set nodes only.
 *
 * Groups are now drawn by the output node itself: the frame has to own a
 * connection handle, and only a real node can. A legacy set from an older
 * document has no such node, so it keeps getting a frame from here.
 *
 * The store selector returns a primitive signature on purpose: returning a new
 * array from a Zustand selector makes `getSnapshot` unstable and React loops
 * forever. The descriptors are then rebuilt in a memo keyed by that signature.
 */
export function SetOutlines() {
  const nodes = useNodes()
  const signature = useWorkspace((state) =>
    state.nodes
      .map((node) =>
        node.type === 'set'
          ? `set:${node.id}~${node.data.color}~${node.data.memberIds.join(',')}`
          : '',
      )
      .filter(Boolean)
      .join('|'),
  )

  const groups = useMemo<GroupDescriptor[]>(() => {
    void signature
    return getActiveWorkspaceStore()
      .getState()
      .nodes.map((node) =>
        node.type === 'set'
          ? { id: node.id, color: node.data.color, memberIds: node.data.memberIds }
          : null,
      )
      .filter((group): group is GroupDescriptor => Boolean(group))
  }, [signature])
  const frames = useMemo<Frame[]>(() => {
    const byId = new Map(nodes.map((node) => [node.id, node]))
    const result: Frame[] = []
    for (const group of groups) {
      const boxes = group.memberIds
        .map((id) => byId.get(id))
        .filter((node): node is NonNullable<typeof node> => Boolean(node))
        .map((node) => ({
          x: node.position.x,
          y: node.position.y,
          width: node.width ?? node.measured?.width ?? 320,
          height: node.height ?? node.measured?.height ?? 180,
        }))
      if (boxes.length === 0) continue
      const minX = Math.min(...boxes.map((box) => box.x))
      const minY = Math.min(...boxes.map((box) => box.y))
      const maxX = Math.max(...boxes.map((box) => box.x + box.width))
      const maxY = Math.max(...boxes.map((box) => box.y + box.height))
      result.push({
        id: group.id,
        color: group.color,
        x: minX - PADDING,
        y: minY - PADDING,
        width: maxX - minX + PADDING * 2,
        height: maxY - minY + PADDING * 2,
      })
    }
    return result
  }, [nodes, groups])

  if (frames.length === 0) return null

  return (
    <ViewportPortal>
      <div className="set-outline-layer" aria-hidden="true">
        {frames.map((frame) => (
          <div
            key={frame.id}
            className="set-outline"
            style={{
              left: frame.x,
              top: frame.y,
              width: frame.width,
              height: frame.height,
              borderColor: frame.color,
            }}
          />
        ))}
      </div>
    </ViewportPortal>
  )
}
