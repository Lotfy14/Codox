/**
 * The Customize tab — which optional details exported question sets carry.
 * Choices persist immediately and govern the Convert screen's optional
 * inputs plus the exported CSV's optional columns. They apply to
 * conversions started next; finished runs keep their own snapshot.
 */
import { ChoiceGroup, GlassPanel, Toggle } from '../design/components'
import type { ChoiceOption } from '../design/components'
import { customizeMessages } from '../copy/messages'
import {
  saveCustomizationSettings,
  useCustomizationSettings,
  type TopicsMode,
} from '../state/customization-settings'
import type { YearMode } from '../state/types'

const YEAR_OPTIONS: readonly ChoiceOption<YearMode>[] = [
  {
    value: 'off',
    label: customizeMessages.yearOff,
    hint: customizeMessages.yearOffHint,
  },
  {
    value: 'type',
    label: customizeMessages.yearType,
    hint: customizeMessages.yearTypeHint,
  },
  {
    value: 'ai',
    label: customizeMessages.yearAi,
    hint: customizeMessages.yearAiHint,
  },
]

const TOPICS_OPTIONS: readonly ChoiceOption<TopicsMode>[] = [
  {
    value: 'off',
    label: customizeMessages.topicsOff,
    hint: customizeMessages.topicsOffHint,
  },
  {
    value: 'on',
    label: customizeMessages.topicsOn,
    hint: customizeMessages.topicsOnHint,
  },
]

export function Customizations() {
  const settings = useCustomizationSettings()

  if (settings === undefined) return null

  return (
    <section aria-labelledby="customize-heading" className="ds-convert">
      <header className="ds-work__head">
        <h1 id="customize-heading">{customizeMessages.title}</h1>
      </header>
      <div className="ds-stack">
        <p className="ds-muted">{customizeMessages.subtitle}</p>
        <GlassPanel
          aria-label={customizeMessages.topicsPanelLabel}
          as="section"
          padding="compact"
        >
          <ChoiceGroup
            legend={customizeMessages.topicsLegend}
            onChange={(topicsMode) =>
              void saveCustomizationSettings({ ...settings, topicsMode })
            }
            options={TOPICS_OPTIONS}
            value={settings.topicsMode}
          />
        </GlassPanel>
        <GlassPanel
          aria-label={customizeMessages.yearPanelLabel}
          as="section"
          padding="compact"
        >
          <ChoiceGroup
            legend={customizeMessages.yearLegend}
            onChange={(yearMode) =>
              void saveCustomizationSettings({ ...settings, yearMode })
            }
            options={YEAR_OPTIONS}
            value={settings.yearMode}
          />
        </GlassPanel>
        <GlassPanel
          aria-label={customizeMessages.debugPanelLabel}
          as="section"
          padding="compact"
        >
          <Toggle
            description={customizeMessages.debugHint}
            isSelected={settings.debugConsole}
            label={customizeMessages.debugLabel}
            onChange={(debugConsole) =>
              void saveCustomizationSettings({ ...settings, debugConsole })
            }
          />
        </GlassPanel>
      </div>
    </section>
  )
}
