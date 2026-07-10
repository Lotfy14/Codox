import { Button as AriaButton } from 'react-aria-components/Button'
import {
  GridList,
  GridListItem,
  type Key,
} from 'react-aria-components/GridList'
import { useDragAndDrop } from 'react-aria-components/useDragAndDrop'
import type { ReactNode } from 'react'
import { StatusChip, type ProviderStatus } from './StatusChip'

export interface ProviderOrderItem {
  description?: string
  id: string
  name: string
  status?: ProviderStatus
}

export interface ProviderOrderListProps {
  ariaLabel?: string
  className?: string
  items: readonly ProviderOrderItem[]
  onReorder: (items: ProviderOrderItem[]) => void
  renderDetails?: (item: ProviderOrderItem) => ReactNode
}

function moveItem(
  items: readonly ProviderOrderItem[],
  index: number,
  direction: -1 | 1,
): ProviderOrderItem[] {
  const target = index + direction
  if (target < 0 || target >= items.length) return [...items]

  const reordered = [...items]
  const current = reordered[index]
  const other = reordered[target]
  if (!current || !other) return reordered
  reordered[index] = other
  reordered[target] = current
  return reordered
}

function reorderFromDrop(
  items: readonly ProviderOrderItem[],
  keys: Set<Key>,
  targetKey: Key,
  dropPosition: 'before' | 'after' | 'on',
): ProviderOrderItem[] {
  const moving = items.filter((item) => keys.has(item.id))
  const remaining = items.filter((item) => !keys.has(item.id))
  let targetIndex = remaining.findIndex((item) => item.id === String(targetKey))

  if (targetIndex < 0) return [...items]
  if (dropPosition === 'after') targetIndex += 1

  remaining.splice(targetIndex, 0, ...moving)
  return remaining
}

export function ProviderOrderList({
  ariaLabel = 'Provider failover order',
  className,
  items,
  onReorder,
  renderDetails,
}: ProviderOrderListProps) {
  const { dragAndDropHooks } = useDragAndDrop<ProviderOrderItem>({
    getItems: (keys) =>
      [...keys].map((key) => ({
        'text/plain':
          items.find((item) => item.id === String(key))?.name ?? String(key),
      })),
    onReorder: (event) => {
      onReorder(
        reorderFromDrop(
          items,
          event.keys,
          event.target.key,
          event.target.dropPosition,
        ),
      )
    },
  })

  return (
    <GridList
      aria-label={ariaLabel}
      className={['ds-provider-order', className].filter(Boolean).join(' ')}
      dragAndDropHooks={dragAndDropHooks}
      items={items}
      keyboardNavigationBehavior="tab"
      selectionMode="none"
    >
      {(item) => {
        const index = items.findIndex((candidate) => candidate.id === item.id)
        return (
          <GridListItem
            className="ds-provider-order__item"
            id={item.id}
            textValue={item.name}
          >
            <AriaButton
              aria-label={`Drag ${item.name} to reorder`}
              className="ds-provider-order__drag"
              slot="drag"
            >
              <span aria-hidden="true">⠿</span>
            </AriaButton>
            <div className="ds-provider-order__content">
              <div className="ds-provider-order__heading">
                <strong>{item.name}</strong>
                {index === 0 ? (
                  <span className="ds-provider-order__first">Used first</span>
                ) : null}
                {item.status ? <StatusChip status={item.status} /> : null}
              </div>
              {item.description ? <span>{item.description}</span> : null}
              {renderDetails?.(item)}
            </div>
            <div className="ds-provider-order__moves">
              <AriaButton
                aria-label={`Move ${item.name} up`}
                className="ds-provider-order__move"
                isDisabled={index <= 0}
                onPress={() => onReorder(moveItem(items, index, -1))}
              >
                <span aria-hidden="true">↑</span>
              </AriaButton>
              <AriaButton
                aria-label={`Move ${item.name} down`}
                className="ds-provider-order__move"
                isDisabled={index >= items.length - 1}
                onPress={() => onReorder(moveItem(items, index, 1))}
              >
                <span aria-hidden="true">↓</span>
              </AriaButton>
            </div>
          </GridListItem>
        )
      }}
    </GridList>
  )
}
