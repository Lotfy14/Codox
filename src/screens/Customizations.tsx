/**
 * The Customize tab — which optional details exported question sets carry.
 * Choices persist immediately and govern the Convert screen's optional
 * inputs plus the exported CSV's optional columns. They apply to
 * conversions started next; finished runs keep their own snapshot.
 */
import { ChoiceGroup, GlassPanel, Select, Toggle } from '../design/components'
import type { ChoiceOption, SelectOption } from '../design/components'
import { customizeMessages } from '../copy/messages'
import {
  BOX_PAGES_MAX,
  BOX_PAGES_MIN,
  INDEX_PAGES_MAX,
  INDEX_PAGES_MIN,
  WORKER_CHUNK_MAX,
  WORKER_CHUNK_MIN,
  saveCustomizationSettings,
  useCustomizationSettings,
  type ExportTarget,
  type MatchingMode,
  type TopicsMode,
} from '../state/customization-settings'
import { WORKFLOWS, workflowFor, type WorkflowId } from '../../workflows/registry'
import {
  DEFAULT_GEMINI_VISION_MODEL,
  FALLBACK_GEMINI_VISION_MODEL,
  type EngineModel,
} from '../providers/gemini'
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

const EXPORT_OPTIONS: readonly ChoiceOption<ExportTarget>[] = [
  {
    value: 'triviadox',
    label: customizeMessages.exportTriviadox,
    hint: customizeMessages.exportTriviadoxHint,
  },
  {
    value: 'zip',
    label: customizeMessages.exportZip,
    hint: customizeMessages.exportZipHint,
  },
]

const INDEX_PAGES_OPTIONS: readonly SelectOption<number>[] = Array.from(
  { length: INDEX_PAGES_MAX - INDEX_PAGES_MIN + 1 },
  (_item, index) => {
    const count = INDEX_PAGES_MIN + index
    return { id: count, label: customizeMessages.indexOption(count) }
  },
)

const BOX_PAGES_OPTIONS: readonly SelectOption<number>[] = Array.from(
  { length: BOX_PAGES_MAX - BOX_PAGES_MIN + 1 },
  (_item, index) => {
    const count = BOX_PAGES_MIN + index
    return { id: count, label: customizeMessages.boxOption(count) }
  },
)

const WORKER_CHUNK_OPTIONS: readonly SelectOption<number>[] = Array.from(
  { length: WORKER_CHUNK_MAX - WORKER_CHUNK_MIN + 1 },
  (_item, index) => {
    const count = WORKER_CHUNK_MIN + index
    return { id: count, label: customizeMessages.workerOption(count) }
  },
)

const MATCHING_OPTIONS: readonly ChoiceOption<MatchingMode>[] = [
  {
    value: 'split',
    label: customizeMessages.matchingSplit,
    hint: customizeMessages.matchingSplitHint,
  },
  {
    value: 'skip',
    label: customizeMessages.matchingSkip,
    hint: customizeMessages.matchingSkipHint,
  },
]

const MODEL_SELECT_OPTIONS: readonly SelectOption<EngineModel>[] = [
  { id: DEFAULT_GEMINI_VISION_MODEL, label: customizeMessages.modelNewer },
  { id: FALLBACK_GEMINI_VISION_MODEL, label: customizeMessages.modelOlder },
]

const WORKFLOW_OPTIONS: readonly SelectOption<WorkflowId>[] = WORKFLOWS.map((workflow) => ({
  id: workflow.id,
  label: `${workflow.name} ${workflow.version}`,
}))

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
          aria-label={customizeMessages.workflowPanelLabel}
          as="section"
          padding="compact"
        >
          <Select<WorkflowId>
            description={customizeMessages.workflowHint}
            label={customizeMessages.workflowLabel}
            onChange={(workflowId) => {
              if (workflowId === null) return
              void saveCustomizationSettings({ ...settings, workflowId })
            }}
            options={WORKFLOW_OPTIONS}
            value={settings.workflowId}
          />
        </GlassPanel>
        <GlassPanel
          aria-label={customizeMessages.exportPanelLabel}
          as="section"
          padding="compact"
        >
          <ChoiceGroup
            legend={customizeMessages.exportLegend}
            onChange={(exportTarget) =>
              void saveCustomizationSettings({ ...settings, exportTarget })
            }
            options={EXPORT_OPTIONS}
            value={settings.exportTarget}
          />
        </GlassPanel>
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
          aria-label={customizeMessages.matchingPanelLabel}
          as="section"
          padding="compact"
        >
          <ChoiceGroup
            legend={customizeMessages.matchingLegend}
            onChange={(matchingMode) =>
              void saveCustomizationSettings({ ...settings, matchingMode })
            }
            options={MATCHING_OPTIONS}
            value={settings.matchingMode}
          />
        </GlassPanel>
        <GlassPanel
          aria-label={customizeMessages.indexPanelLabel}
          as="section"
          padding="compact"
        >
          <Select<number>
            description={customizeMessages.indexHint}
            label={customizeMessages.indexLabel}
            onChange={(key) => {
              if (key === null) return
              void saveCustomizationSettings({
                ...settings,
                indexPagesPerCall: key,
              })
            }}
            options={INDEX_PAGES_OPTIONS}
            value={settings.indexPagesPerCall}
          />
        </GlassPanel>
        <GlassPanel
          aria-label={customizeMessages.boxPanelLabel}
          as="section"
          padding="compact"
        >
          <Toggle
            description={customizeMessages.boxCropsHint}
            isSelected={settings.boxCrops}
            label={customizeMessages.boxCropsLabel}
            onChange={(boxCrops) => void saveCustomizationSettings({ ...settings, boxCrops })}
          />
        </GlassPanel>        <GlassPanel
          aria-label={customizeMessages.boxPanelLabel}
          as="section"
          padding="compact"
        >
          <Select<number>
            description={customizeMessages.boxHint}
            label={customizeMessages.boxLabel}
            onChange={(key) => {
              if (key === null) return
              void saveCustomizationSettings({
                ...settings,
                boxPagesPerCall: key,
              })
            }}
            options={BOX_PAGES_OPTIONS}
            value={settings.boxPagesPerCall}
          />
        </GlassPanel>
        <GlassPanel
          aria-label={customizeMessages.workerPanelLabel}
          as="section"
          padding="compact"
        >
          <Select<number>
            description={customizeMessages.workerHint}
            label={customizeMessages.workerLabel}
            onChange={(key) => {
              if (key === null) return
              void saveCustomizationSettings({
                ...settings,
                workerChunkSize: key,
              })
            }}
            options={WORKER_CHUNK_OPTIONS}
            value={settings.workerChunkSize}
          />
        </GlassPanel>
        <GlassPanel
          aria-label={customizeMessages.modelsPanelLabel}
          as="section"
          padding="compact"
        >
          <div className="ds-stack">
            <p className="ds-muted">{customizeMessages.modelsIntro}</p>
            {/* The pickers, their labels, and which steps each one sets all
                belong to the selected workflow — this screen only renders
                them, so a new mineral needs no edit here. */}
            {workflowFor(settings.workflowId).models.groups.map(({ steps, label, hint }) => (
              <Select<EngineModel>
                key={label}
                description={hint}
                label={label}
                onChange={(model) => {
                  if (model === null) return
                  void saveCustomizationSettings({
                    ...settings,
                    engineModels: { ...settings.engineModels, ...Object.fromEntries(steps.map((step) => [step, model])) },
                  })
                }}
                options={MODEL_SELECT_OPTIONS}
                value={settings.engineModels[steps[0]]}
              />
            ))}
          </div>
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
