import { useState } from 'react'
import {
  AppShell,
  Badge,
  Button,
  Dialog,
  FileDropZone,
  FileRow,
  GlassInput,
  GlassPanel,
  ProgressBar,
  ProviderOrderList,
  ResumeCard,
  Select,
  StatusChip,
  StorageMeter,
  TabNav,
  ThemeSwitcher,
  Toggle,
  TypewriterLine,
} from '../design/components'
import type {
  AppTab,
  BadgeTone,
  FileAnswerSource,
  ProviderOrderItem,
  SelectOption,
  StatusChipStatus,
} from '../design/components'
import { sillySentences } from '../design/silly-sentences'
import './DesignGallery.css'

interface ColorToken {
  dark: string
  light: string
  token: `--${string}`
}

interface ColorTokenGroup {
  description: string
  label: string
  tokens: readonly ColorToken[]
}

interface GalleryFile {
  answerSource?: FileAnswerSource
  flagged?: boolean
  id: string
  isDisabled?: boolean
  name: string
  size: number
}

const colorTokenGroups: readonly ColorTokenGroup[] = [
  {
    label: 'Surfaces',
    description: 'Parchment and midnight foundations, plus solid list rows.',
    tokens: [
      { token: '--color-surface', light: '#fff8f7', dark: '#011a36' },
      { token: '--color-surface-elevated', light: '#ffffff', dark: '#0d1117' },
      {
        token: '--color-card-fill',
        light: 'rgb(255 255 255 / 88%)',
        dark: 'rgb(13 17 23 / 75%)',
      },
      {
        token: '--color-outline',
        light: 'rgb(128 0 32 / 22%)',
        dark: 'rgb(255 255 255 / 10%)',
      },
      { token: '--color-row', light: '#ffffff', dark: '#12283f' },
      {
        token: '--color-row-hover',
        light: '#f7edef',
        dark: '#18334f',
      },
      {
        token: '--color-scrim',
        light: 'rgb(43 17 24 / 54%)',
        dark: 'rgb(0 5 12 / 72%)',
      },
    ],
  },
  {
    label: 'Text, primary action, and focus',
    description: 'One burgundy action family with accessible text and focus pairs.',
    tokens: [
      { token: '--color-text-strong', light: '#2b1118', dark: '#f8fafc' },
      { token: '--color-text-muted', light: '#6f4e57', dark: '#b8c3d1' },
      { token: '--color-text-on-primary', light: '#ffffff', dark: '#ffffff' },
      { token: '--color-primary', light: '#800020', dark: '#af2b3e' },
      { token: '--color-primary-foreground', light: '#800020', dark: '#ff9aac' },
      { token: '--color-primary-hover', light: '#68001a', dark: '#c43d51' },
      { token: '--color-primary-soft', light: '#f7e8ec', dark: '#381827' },
      { token: '--color-primary-border', light: '#bb8291', dark: '#9f4c5d' },
      { token: '--color-control-border', light: '#9a5a6a', dark: '#71869d' },
      { token: '--color-focus-ring', light: '#800020', dark: '#ff9aac' },
      {
        token: '--color-focus-halo',
        light: 'rgb(128 0 32 / 20%)',
        dark: 'rgb(255 154 172 / 24%)',
      },
    ],
  },
  {
    label: 'Semantic feedback',
    description: 'Quota, success, errors, reachability, and neutral states stay distinct.',
    tokens: [
      { token: '--color-warning', light: '#f59e0b', dark: '#f59e0b' },
      { token: '--color-warning-foreground', light: '#6f3d00', dark: '#fcd34d' },
      { token: '--color-warning-surface', light: '#fff2d8', dark: '#352b16' },
      { token: '--color-warning-border', light: '#d89218', dark: '#a97a20' },
      { token: '--color-success', light: '#10b981', dark: '#10b981' },
      { token: '--color-success-foreground', light: '#075e45', dark: '#6ee7b7' },
      { token: '--color-success-surface', light: '#e6f7f1', dark: '#062c35' },
      { token: '--color-success-border', light: '#48a889', dark: '#278d70' },
      { token: '--color-danger', light: '#8f1230', dark: '#fb7185' },
      { token: '--color-text-on-danger', light: '#ffffff', dark: '#2b1118' },
      { token: '--color-danger-hover', light: '#720d26', dark: '#f98a9a' },
      { token: '--color-danger-foreground', light: '#8f1230', dark: '#fb7185' },
      { token: '--color-danger-surface', light: '#fde8ed', dark: '#3b1726' },
      { token: '--color-danger-border', light: '#cb8295', dark: '#a7475d' },
      {
        token: '--color-unreachable-foreground',
        light: '#365b7a',
        dark: '#c8d5e4',
      },
      { token: '--color-unreachable-surface', light: '#edf3f8', dark: '#12283f' },
      { token: '--color-unreachable-border', light: '#91a9bc', dark: '#496782' },
      { token: '--color-neutral-surface', light: '#f4edef', dark: '#17283b' },
      { token: '--color-neutral-border', light: '#94717b', dark: '#617991' },
    ],
  },
  {
    label: 'Resolved glass colors',
    description: 'Theme-specific translucency with opaque fallbacks for unsupported browsers.',
    tokens: [
      {
        token: '--glass-panel-background',
        light: 'rgb(255 255 255 / 88%)',
        dark: 'rgb(13 17 23 / 75%)',
      },
      {
        token: '--glass-panel-border',
        light: 'rgb(128 0 32 / 22%)',
        dark: 'rgb(255 255 255 / 10%)',
      },
      {
        token: '--glass-input-background',
        light: 'rgb(255 255 255 / 58%)',
        dark: 'rgb(255 255 255 / 2%)',
      },
      {
        token: '--glass-input-border',
        light: '#9a5a6a',
        dark: '#71869d',
      },
      { token: '--glass-panel-fallback', light: '#ffffff', dark: '#0d1117' },
      { token: '--glass-input-fallback', light: '#fffafa', dark: '#132238' },
    ],
  },
]

const typeScale = [
  { token: '--font-size-xs', value: '12px', use: 'Metadata and status labels' },
  { token: '--font-size-sm', value: '14px', use: 'Supporting copy' },
  { token: '--font-size-md', value: '16px', use: 'Body and controls' },
  { token: '--font-size-lg', value: '18px', use: 'Lead copy' },
  { token: '--font-size-xl', value: '22px', use: 'Card headings' },
  { token: '--font-size-2xl', value: '26px', use: 'Section headings' },
  { token: '--font-size-3xl', value: '32px', use: 'Screen headings' },
] as const

const spacingScale = [
  { token: '--space-0', value: '0px' },
  { token: '--space-1', value: '4px' },
  { token: '--space-2', value: '8px' },
  { token: '--space-3', value: '12px' },
  { token: '--space-4', value: '16px' },
  { token: '--space-5', value: '20px' },
  { token: '--space-6', value: '24px' },
  { token: '--space-8', value: '32px' },
  { token: '--space-10', value: '40px' },
  { token: '--space-12', value: '48px' },
  { token: '--space-16', value: '64px' },
  { token: '--space-24', value: '96px' },
] as const

const radiusScale = [
  { token: '--radius-input', value: '12px', label: 'Input' },
  { token: '--radius-chip', value: '16px', label: 'Chip' },
  { token: '--radius-card', value: '20px', label: 'Card' },
  { token: '--radius-action', value: '28px', label: 'Action' },
  { token: '--radius-dashboard', value: '32px', label: 'Dashboard' },
  { token: '--radius-dashboard-large', value: '40px', label: 'Large dashboard' },
  { token: '--radius-full', value: '999px', label: 'Pill and bar' },
] as const

const badgeTones: readonly { label: string; tone: BadgeTone }[] = [
  { tone: 'neutral', label: 'Not exported yet' },
  { tone: 'primary', label: 'Used first' },
  { tone: 'success', label: 'Exported' },
  { tone: 'warning', label: '4 flags left' },
  { tone: 'danger', label: 'Needs a new key' },
]

const statusStates: readonly StatusChipStatus[] = [
  'idle',
  'checking',
  'working',
  'wrong-key',
  'unreachable',
  'quota-paused',
]

const retentionOptions: readonly SelectOption<string>[] = [
  {
    id: 'until-deleted',
    label: 'Keep until deleted',
    description: 'Nothing is removed automatically.',
  },
  {
    id: 'last-ten',
    label: 'Keep last 10 runs',
    description: 'Older completed runs are cleaned up.',
  },
  {
    id: 'thirty-days',
    label: 'Auto-clean after 30 days',
    description: 'Original PDFs follow the same retention rule.',
  },
]

const initialProviders: readonly ProviderOrderItem[] = [
  {
    id: 'gemini',
    name: 'Gemini',
    description: 'Primary free provider',
    status: 'working',
  },
  {
    id: 'groq',
    name: 'Groq',
    description: 'Ready when the first provider rests',
    status: 'quota-paused',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Key needs attention before failover',
    status: 'wrong-key',
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    description: 'Temporary network problem',
    status: 'unreachable',
  },
]

const initialFiles: readonly GalleryFile[] = [
  {
    id: 'biology',
    name: 'biology_midterm.pdf',
    size: 4_810_752,
    answerSource: 'inside',
  },
  {
    id: 'chemistry',
    name: 'chemistry_mock_exam.pdf',
    size: 8_188_928,
    answerSource: 'key-file',
    flagged: true,
  },
  {
    id: 'archive',
    name: 'archived_sample.pdf',
    size: 1_310_720,
    isDisabled: true,
  },
]

function ColorSwatch({ color }: { color: ColorToken }) {
  return (
    <li className="ds-gallery-color-card">
      <div aria-hidden="true" className="ds-gallery-color-preview">
        <span style={{ background: color.light }}>
          <small>Light</small>
        </span>
        <span style={{ background: color.dark }}>
          <small>Dark</small>
        </span>
        <i style={{ background: `var(${color.token})` }} title="Currently resolved color" />
      </div>
      <div className="ds-gallery-color-copy">
        <code>{color.token}</code>
        <span>Light · {color.light}</span>
        <span>Dark · {color.dark}</span>
      </div>
    </li>
  )
}

function SectionHeading({
  description,
  eyebrow,
  id,
  title,
}: {
  description: string
  eyebrow: string
  id: string
  title: string
}) {
  return (
    <header className="ds-gallery-section-heading">
      <p className="ds-gallery-eyebrow">{eyebrow}</p>
      <h2 id={id}>{title}</h2>
      <p>{description}</p>
    </header>
  )
}

export function DesignGallery() {
  const [activeTab, setActiveTab] = useState<AppTab>('convert')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogResult, setDialogResult] = useState('No destructive action taken.')
  const [droppedFiles, setDroppedFiles] = useState<readonly string[]>([])
  const [files, setFiles] = useState<GalleryFile[]>(() => [...initialFiles])
  const [keepOriginal, setKeepOriginal] = useState(true)
  const [autoClean, setAutoClean] = useState(false)
  const [providers, setProviders] = useState<ProviderOrderItem[]>(() => [
    ...initialProviders,
  ])
  const [retention, setRetention] = useState<string>('until-deleted')
  const [reviewTakeover, setReviewTakeover] = useState(false)
  const [lastAction, setLastAction] = useState('Try the controls—the gallery keeps state locally.')

  const updateFileAnswerSource = (
    id: string,
    answerSource: FileAnswerSource | undefined,
  ) => {
    setFiles((currentFiles) =>
      currentFiles.map((file) =>
        file.id === id ? { ...file, answerSource } : file,
      ),
    )
  }

  return (
    <div className="ds-gallery">
      <GlassPanel as="section" className="ds-gallery-hero" padding="spacious">
        <div className="ds-gallery-hero-copy">
          <p className="ds-gallery-eyebrow">Codox · living review surface</p>
          <h1 id="design-gallery-heading">The system, under real light.</h1>
          <p className="ds-gallery-hero-lede">
            Triviadox glass over parchment and midnight, built for calm exam
            conversion. Every sample below uses the shipped tokens and component APIs.
          </p>
          <ThemeSwitcher className="ds-gallery-theme-switcher" label="Preview theme" />
        </div>
        <div className="ds-gallery-identity">
          <img alt="Codox Neon Scan logo" height="112" src="/logo.svg" width="112" />
          <p>
            <strong>Neon Scan</strong>
            <span>The identity mark keeps its own palette; UI tokens stay independent.</span>
          </p>
        </div>
      </GlassPanel>

      <nav aria-label="Gallery sections" className="ds-gallery-jump-nav">
        <a href="#gallery-colors">Colors</a>
        <a href="#gallery-foundations">Foundations</a>
        <a href="#gallery-actions">Controls</a>
        <a href="#gallery-files">Files</a>
        <a href="#gallery-progress">Progress</a>
        <a href="#gallery-shell">Shell</a>
      </nav>

      <section
        aria-labelledby="gallery-colors"
        className="ds-gallery-section"
      >
        <SectionHeading
          description="Each card pairs the resolved light and dark values. The round marker is the value active in the gallery's current theme."
          eyebrow="01 · Color system"
          id="gallery-colors"
          title="Semantic color, not decoration"
        />
        <div className="ds-gallery-color-groups">
          {colorTokenGroups.map((group) => (
            <section aria-labelledby={`gallery-${group.label.replaceAll(' ', '-').toLowerCase()}`} key={group.label}>
              <div className="ds-gallery-subheading">
                <h3 id={`gallery-${group.label.replaceAll(' ', '-').toLowerCase()}`}>
                  {group.label}
                </h3>
                <p>{group.description}</p>
              </div>
              <ul className="ds-gallery-color-grid">
                {group.tokens.map((color) => (
                  <ColorSwatch color={color} key={color.token} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </section>

      <section
        aria-labelledby="gallery-foundations"
        className="ds-gallery-section"
      >
        <SectionHeading
          description="The scales encode hierarchy and rhythm; screen work should consume these values instead of inventing one-offs."
          eyebrow="02 · Foundations"
          id="gallery-foundations"
          title="Type, rhythm, and geometry"
        />

        <div className="ds-gallery-foundation-stack">
          <section aria-labelledby="gallery-type-heading" className="ds-gallery-foundation-block">
            <div className="ds-gallery-subheading">
              <h3 id="gallery-type-heading">Typography</h3>
              <p>
                Plus Jakarta Sans 800 leads; Inter 400 and 500 carries everything else.
              </p>
            </div>
            <div className="ds-gallery-font-pair">
              <p className="ds-gallery-font-heading">
                <span>Heading · 800</span>
                Answers become structured data.
              </p>
              <p className="ds-gallery-font-body">
                <span>Body · 400 / 500</span>
                A calm interface keeps the work legible, local, and honest.
              </p>
              <p className="ds-gallery-label-sample">Label · 800 · 0.12em tracking</p>
            </div>
            <ol className="ds-gallery-type-scale">
              {typeScale.map((type) => (
                <li key={type.token}>
                  <div>
                    <code>{type.token}</code>
                    <span>{type.value} · {type.use}</span>
                  </div>
                  <p style={{ fontSize: `var(${type.token})` }}>Codox reads the page clearly.</p>
                </li>
              ))}
            </ol>
          </section>

          <div className="ds-gallery-foundation-grid">
            <section aria-labelledby="gallery-spacing-heading" className="ds-gallery-foundation-block">
              <div className="ds-gallery-subheading">
                <h3 id="gallery-spacing-heading">Four-pixel spacing</h3>
                <p>Mobile layout gap: 16px · desktop layout gap: 32px.</p>
              </div>
              <ol className="ds-gallery-spacing-scale">
                {spacingScale.map((space) => (
                  <li key={space.token}>
                    <code>{space.token}</code>
                    <span
                      aria-hidden="true"
                      className="ds-gallery-spacing-bar"
                      style={{ inlineSize: `var(${space.token})` }}
                    />
                    <span>{space.value}</span>
                  </li>
                ))}
              </ol>
            </section>

            <section aria-labelledby="gallery-radius-heading" className="ds-gallery-foundation-block">
              <div className="ds-gallery-subheading">
                <h3 id="gallery-radius-heading">Triviadox radii</h3>
                <p>Geometry moves from compact controls to generous dashboard frames.</p>
              </div>
              <ul className="ds-gallery-radius-grid">
                {radiusScale.map((radius) => (
                  <li key={radius.token}>
                    <span
                      aria-hidden="true"
                      className="ds-gallery-radius-shape"
                      style={{ borderRadius: `var(${radius.token})` }}
                    />
                    <strong>{radius.label}</strong>
                    <code>{radius.token}</code>
                    <span>{radius.value}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <div className="ds-gallery-foundation-grid">
            <section aria-labelledby="gallery-glass-heading" className="ds-gallery-foundation-block">
              <div className="ds-gallery-subheading">
                <h3 id="gallery-glass-heading">Glass and shadows</h3>
                <p>One translucent layer, backed by an opaque fallback.</p>
              </div>
              <div className="ds-gallery-glass-stage">
                <GlassPanel as="article" padding="default">
                  <p className="ds-gallery-surface-label">Panel recipe</p>
                  <strong>40px blur · 160% saturation</strong>
                  <span>Theme fill + outline · shared glass shadow</span>
                </GlassPanel>
                <div className="ds-gallery-shadow-samples">
                  <span style={{ boxShadow: 'var(--glass-shadow)' }}>Glass</span>
                  <span style={{ boxShadow: 'var(--shadow-raised)' }}>Raised</span>
                  <span style={{ boxShadow: 'var(--shadow-dialog)' }}>Dialog</span>
                </div>
              </div>
              <dl className="ds-gallery-token-notes">
                <div><dt>Panel</dt><dd>40px blur · 160% saturation</dd></div>
                <div><dt>Input</dt><dd>12px blur · 150% saturation</dd></div>
                <div><dt>Fallback</dt><dd>Opaque, same border and geometry</dd></div>
              </dl>
            </section>

            <section aria-labelledby="gallery-interaction-heading" className="ds-gallery-foundation-block">
              <div className="ds-gallery-subheading">
                <h3 id="gallery-interaction-heading">Motion, focus, and touch</h3>
                <p>Purposeful feedback only, with a complete reduced-motion escape hatch.</p>
              </div>
              <ul className="ds-gallery-motion-list">
                <li><i className="ds-gallery-motion-dot ds-gallery-motion-dot-fast" /><strong>120ms</strong><span>Fast · hover and control feedback</span><code>--motion-duration-fast</code></li>
                <li><i className="ds-gallery-motion-dot ds-gallery-motion-dot-standard" /><strong>200ms</strong><span>Standard · tabs, cards, dialog</span><code>--motion-duration-standard</code></li>
                <li><i className="ds-gallery-motion-dot ds-gallery-motion-dot-slow" /><strong>320ms</strong><span>Slow · real progress glides</span><code>--motion-duration-slow</code></li>
              </ul>
              <div className="ds-gallery-interaction-contracts">
                <button className="ds-gallery-focus-demo" type="button">
                  Focus ring · 3px + 3px offset
                </button>
                <div className="ds-gallery-touch-demo">
                  <span aria-hidden="true">44</span>
                  <p><strong>44px minimum</strong><small>Every interactive target</small></p>
                </div>
              </div>
              <p className="ds-gallery-reduced-motion-note">
                <strong>Reduce motion:</strong> transitions collapse, the spinner stops,
                and typewriter sentences appear immediately.
              </p>
            </section>
          </div>

          <section aria-labelledby="gallery-padding-heading" className="ds-gallery-foundation-block">
            <div className="ds-gallery-subheading">
              <h3 id="gallery-padding-heading">GlassPanel padding states</h3>
              <p>Each is a standalone glass surface—none is placed inside another.</p>
            </div>
            <div className="ds-gallery-padding-grid">
              {(['none', 'compact', 'default', 'spacious'] as const).map((padding) => (
                <GlassPanel as="article" key={padding} padding={padding}>
                  <div className="ds-gallery-padding-content">
                    <strong>{padding}</strong>
                    <code>padding="{padding}"</code>
                  </div>
                </GlassPanel>
              ))}
            </div>
          </section>
        </div>
      </section>

      <section aria-labelledby="gallery-actions" className="ds-gallery-section">
        <SectionHeading
          description="These states are wired, keyboard-operable, and kept local to this development view."
          eyebrow="03 · Controls and feedback"
          id="gallery-actions"
          title="The small moments carry the trust"
        />

        <div className="ds-gallery-component-grid">
          <section aria-labelledby="gallery-buttons-heading" className="ds-gallery-component-card">
            <div className="ds-gallery-subheading">
              <h3 id="gallery-buttons-heading">Button</h3>
              <p>Variants, pending, and unavailable.</p>
            </div>
            <div className="ds-gallery-button-row">
              <Button onPress={() => setLastAction('Primary action pressed.')}>Primary</Button>
              <Button onPress={() => setLastAction('Secondary action pressed.')} variant="secondary">Secondary</Button>
              <Button onPress={() => setLastAction('Quiet action pressed.')} variant="quiet">Quiet</Button>
              <Button onPress={() => setLastAction('Danger action pressed.')} variant="danger">Danger</Button>
              <Button isLoading loadingLabel="Converting…">Loading</Button>
              <Button isDisabled variant="secondary">Disabled</Button>
            </div>
            <p aria-live="polite" className="ds-gallery-live-note">{lastAction}</p>
          </section>

          <section aria-labelledby="gallery-badges-heading" className="ds-gallery-component-card">
            <div className="ds-gallery-subheading">
              <h3 id="gallery-badges-heading">Badge</h3>
              <p>Quiet metadata—not a live status region.</p>
            </div>
            <div className="ds-gallery-chip-row">
              {badgeTones.map((badge) => (
                <Badge key={badge.tone} tone={badge.tone}>{badge.label}</Badge>
              ))}
            </div>
          </section>

          <section aria-labelledby="gallery-status-heading" className="ds-gallery-component-card ds-gallery-component-card-wide">
            <div className="ds-gallery-subheading">
              <h3 id="gallery-status-heading">StatusChip</h3>
              <p>Wrong key, unreachable, and quota rest are deliberately different.</p>
            </div>
            <div className="ds-gallery-chip-row">
              {statusStates.map((status) => (
                <StatusChip key={status} status={status} />
              ))}
            </div>
          </section>

          <section aria-labelledby="gallery-input-heading" className="ds-gallery-component-card ds-gallery-component-card-wide">
            <div className="ds-gallery-subheading">
              <h3 id="gallery-input-heading">GlassInput</h3>
              <p>Default, verified, wrong-key, and disabled states.</p>
            </div>
            <div className="ds-gallery-fields-grid">
              <GlassInput
                defaultValue="AIzaSyGalleryExample"
                description="Paste a key; it never leaves this device except for validation."
                label="Provider key"
                type="password"
              />
              <GlassInput
                defaultValue="AIzaSyVerifiedExample"
                label="Verified key"
                status="success"
                successMessage="Key works."
                type="password"
              />
              <GlassInput
                defaultValue="invalid-key"
                errorMessage="That key was rejected. Paste a new one."
                label="Wrong key"
                status="error"
                type="password"
              />
              <GlassInput
                defaultValue="Unavailable while checking"
                description="A disabled field remains legible."
                isDisabled
                label="Disabled"
              />
            </div>
          </section>

          <section aria-labelledby="gallery-select-heading" className="ds-gallery-component-card">
            <div className="ds-gallery-subheading">
              <h3 id="gallery-select-heading">Select</h3>
              <p>Controlled listbox, invalid, and disabled.</p>
            </div>
            <div className="ds-gallery-field-stack">
              <Select
                description="Applied when Codox opens."
                label="Retention"
                onChange={(key) => {
                  if (key !== null) setRetention(key)
                }}
                options={retentionOptions}
                value={retention}
              />
              <Select
                errorMessage="Choose a retention rule."
                isInvalid
                label="Needs a choice"
                options={retentionOptions}
                value={null}
              />
              <Select
                isDisabled
                label="Disabled selection"
                options={retentionOptions}
                value="last-ten"
              />
            </div>
          </section>

          <section aria-labelledby="gallery-toggle-heading" className="ds-gallery-component-card">
            <div className="ds-gallery-subheading">
              <h3 id="gallery-toggle-heading">Toggle</h3>
              <p>On, off, invalid, and disabled.</p>
            </div>
            <div className="ds-gallery-field-stack">
              <Toggle
                description="Allows this run to be converted again later."
                isSelected={keepOriginal}
                label="Keep original PDF"
                onChange={setKeepOriginal}
              />
              <Toggle
                description="Off until the user opts in."
                isSelected={autoClean}
                label="Auto-clean old runs"
                onChange={setAutoClean}
              />
              <Toggle
                errorMessage="Resolve this setting before continuing."
                isInvalid
                label="Invalid setting"
              />
              <Toggle isDisabled label="Disabled setting" />
            </div>
          </section>
        </div>
      </section>

      <section aria-labelledby="gallery-files" className="ds-gallery-section">
        <SectionHeading
          description="Upload state and dense scanning patterns are composed exactly as future Convert screens will use them."
          eyebrow="04 · Upload and provider order"
          id="gallery-files"
          title="Files arrive; declarations stay explicit"
        />

        <div className="ds-gallery-upload-grid">
          <section aria-labelledby="gallery-drop-heading" className="ds-gallery-component-card">
            <div className="ds-gallery-subheading">
              <h3 id="gallery-drop-heading">FileDropZone</h3>
              <p>Real PDF input, drag target, and disabled state.</p>
            </div>
            <FileDropZone
              onFiles={(newFiles) => {
                setDroppedFiles(newFiles.map((file) => file.name))
              }}
            />
            <p aria-live="polite" className="ds-gallery-live-note">
              {droppedFiles.length > 0
                ? `Selected: ${droppedFiles.join(', ')}`
                : 'No gallery files selected.'}
            </p>
            <FileDropZone
              description="Unavailable while a batch is being prepared"
              isDisabled
              label="Upload paused"
              onFiles={() => undefined}
            />
          </section>

          <section aria-labelledby="gallery-provider-heading" className="ds-gallery-component-card">
            <div className="ds-gallery-subheading">
              <h3 id="gallery-provider-heading">ProviderOrderList</h3>
              <p>Drag, keyboard reorder, touch controls, and explicit arrows.</p>
            </div>
            <ProviderOrderList
              items={providers}
              onReorder={setProviders}
              renderDetails={(provider) => (
                <GlassInput
                  aria-label={`${provider.name} API key`}
                  defaultValue={`${provider.id}-gallery-key`}
                  label={`${provider.name} key`}
                  type="password"
                />
              )}
            />
          </section>
        </div>

        <section aria-labelledby="gallery-solid-rows-heading" className="ds-gallery-solid-pattern">
          <div className="ds-gallery-subheading">
            <h3 id="gallery-solid-rows-heading">One glass container. Solid rows inside.</h3>
            <p>
              This is the required dense-list pattern: no stacked glass and no
              per-row backdrop filter.
            </p>
          </div>
          <div className="ds-gallery-glass-stage ds-gallery-row-stage">
            <GlassPanel as="article" padding="compact">
              <div className="ds-gallery-list-header">
                <div>
                  <p className="ds-gallery-surface-label">Batch files</p>
                  <strong>{files.length} PDF{files.length === 1 ? '' : 's'} ready</strong>
                </div>
                {files.length < initialFiles.length ? (
                  <Button onPress={() => setFiles([...initialFiles])} variant="quiet">
                    Reset rows
                  </Button>
                ) : null}
              </div>
              <div className="ds-gallery-solid-row-list" role="list">
                {files.map((file) => (
                  <FileRow
                    answerSource={file.answerSource}
                    flagged={file.flagged}
                    isDisabled={file.isDisabled}
                    key={file.id}
                    name={file.name}
                    onAnswerSourceChange={(answerSource) =>
                      updateFileAnswerSource(file.id, answerSource)
                    }
                    onRemove={file.isDisabled
                      ? undefined
                      : () => setFiles((currentFiles) =>
                          currentFiles.filter((candidate) => candidate.id !== file.id),
                        )}
                    role="listitem"
                    size={file.size}
                  />
                ))}
              </div>
            </GlassPanel>
          </div>
          <p className="ds-gallery-rule-callout">
            <span aria-hidden="true">✓</span>
            <strong>Performance contract:</strong> the outer panel owns the blur;
            every file row uses <code>--color-row</code>.
          </p>
        </section>
      </section>

      <section aria-labelledby="gallery-progress" className="ds-gallery-section">
        <SectionHeading
          description="Progress reports real work. The silly line adds life without pretending to know engine state."
          eyebrow="05 · Progress and continuity"
          id="gallery-progress"
          title="Calm truth, with one small grin"
        />
        <div className="ds-gallery-component-grid">
          <section aria-labelledby="gallery-progressbar-heading" className="ds-gallery-component-card ds-gallery-component-card-wide">
            <div className="ds-gallery-subheading">
              <h3 id="gallery-progressbar-heading">ProgressBar + TypewriterLine</h3>
              <p>Determinate fraction on the bar; fixed calm sentence rotation below.</p>
            </div>
            <div className="ds-gallery-progress-stack">
              <div>
                <ProgressBar label="biology_midterm.pdf" max={52} value={37} />
                <TypewriterLine rotationInterval={8_000} sentences={sillySentences} />
              </div>
              <div>
                <ProgressBar label="answer_key.pdf" max={18} value={18} />
                <p className="ds-gallery-serious-line ds-gallery-serious-line-success">
                  Ready to review.
                </p>
              </div>
              <div className="ds-gallery-serious-states">
                <p className="ds-gallery-serious-line ds-gallery-serious-line-warning">
                  Paused — resumes when quota allows.
                </p>
                <p className="ds-gallery-serious-line ds-gallery-serious-line-danger">
                  Conversion stopped — check the provider key, then try again.
                </p>
              </div>
            </div>
          </section>

          <section aria-labelledby="gallery-storage-heading" className="ds-gallery-component-card">
            <div className="ds-gallery-subheading">
              <h3 id="gallery-storage-heading">StorageMeter</h3>
              <p>Empty, typical, and near-capacity readings.</p>
            </div>
            <div className="ds-gallery-field-stack">
              <StorageMeter label="Empty storage" total={1_073_741_824} used={0} />
              <StorageMeter label="Local Codox storage" total={1_073_741_824} used={386_547_056} />
              <StorageMeter label="Storage nearly full" total={1_073_741_824} used={998_579_896} />
            </div>
          </section>

          <section aria-labelledby="gallery-resume-heading" className="ds-gallery-component-card">
            <div className="ds-gallery-subheading">
              <h3 id="gallery-resume-heading">ResumeCard</h3>
              <p>Active minimized review and unavailable state.</p>
            </div>
            <div className="ds-gallery-field-stack">
              <ResumeCard
                fileName="bio_exam.pdf"
                flagsLeft={4}
                onContinue={() => setLastAction('Review resumed from the card.')}
              />
              <ResumeCard fileName="completed_exam.pdf" flagsLeft={0} isDisabled />
            </div>
          </section>

          <section aria-labelledby="gallery-dialog-heading" className="ds-gallery-component-card ds-gallery-component-card-wide">
            <div className="ds-gallery-subheading">
              <h3 id="gallery-dialog-heading">Dialog</h3>
              <p>Controlled, focus-trapped confirmation with a calm destructive path.</p>
            </div>
            <div className="ds-gallery-dialog-demo">
              <Button onPress={() => setDialogOpen(true)} variant="danger">
                Open delete confirmation
              </Button>
              <span aria-live="polite">{dialogResult}</span>
            </div>
            <Dialog
              actions={(close) => (
                <>
                  <Button onPress={close} variant="quiet">Cancel</Button>
                  <Button
                    onPress={() => {
                      setDialogResult('Gallery run deleted. No persisted data changed.')
                      close()
                    }}
                    variant="danger"
                  >
                    Delete run
                  </Button>
                </>
              )}
              description="This removes the run and its locally stored files. Exported bundles are not affected."
              isOpen={dialogOpen}
              onOpenChange={setDialogOpen}
              role="alertdialog"
              title="Delete biology_midterm?"
            >
              This gallery action only updates local component state.
            </Dialog>
          </section>
        </div>
      </section>

      <section aria-labelledby="gallery-shell" className="ds-gallery-section">
        <SectionHeading
          description="The same navigation becomes a desktop sidebar or phone bottom bar; focused review removes it without trapping the user."
          eyebrow="06 · Composition"
          id="gallery-shell"
          title="AppShell and responsive navigation"
        />
        <div className="ds-gallery-shell-frame">
          <AppShell
            header={(
              <div className="ds-gallery-shell-header">
                <span className="ds-gallery-shell-brand">
                  <img alt="" height="40" src="/logo.svg" width="40" />
                  <span><strong>Codox</strong><small>Local exam conversion</small></span>
                </span>
                <Badge tone="neutral">Not exported yet</Badge>
              </div>
            )}
            isReviewTakeover={reviewTakeover}
            mainAs="div"
            navigation={(
              <TabNav
                activeTab={activeTab}
                onTabChange={(tab) => {
                  setActiveTab(tab)
                  setLastAction(`${tab} navigation selected.`)
                }}
              />
            )}
            onMinimizeReview={() => setReviewTakeover(false)}
          >
            {reviewTakeover ? (
              <article className="ds-gallery-shell-content ds-gallery-review-preview">
                <p className="ds-gallery-eyebrow">Focused review · flag 2 of 4</p>
                <h3>Which structure carries oxygen?</h3>
                <p>
                  The review canvas takes every available pixel. Minimize remains
                  reachable above so the user is never locked in.
                </p>
                <div className="ds-gallery-review-answer">
                  <Badge tone="warning">Needs review</Badge>
                  <strong>Current answer: mitochondrion</strong>
                  <span>Source crop would sit beside this card on desktop.</span>
                </div>
              </article>
            ) : (
              <article className="ds-gallery-shell-content">
                <div>
                  <p className="ds-gallery-eyebrow">{activeTab} workspace</p>
                  <h3>{activeTab === 'convert' ? 'Ready for another exam?' : `${activeTab[0]?.toUpperCase()}${activeTab.slice(1)}`}</h3>
                  <p>
                    This miniature shell uses the production AppShell and TabNav,
                    including the viewport-driven responsive layout.
                  </p>
                </div>
                <Button onPress={() => setReviewTakeover(true)} variant="secondary">
                  Enter focused review
                </Button>
              </article>
            )}
          </AppShell>
        </div>
        <p className="ds-gallery-responsive-note">
          Resize through 64rem to inspect sidebar → bottom-nav behavior. At 375px,
          cards collapse to one column without changing components.
        </p>
      </section>
    </div>
  )
}
