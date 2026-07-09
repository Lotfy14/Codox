import { Phase2SpikeChecks } from './Phase2SpikeChecks'

export function Export() {
  return (
    <section className="screen" aria-labelledby="export-heading">
      <h1 id="export-heading">Export</h1>
      <p>
        Export early and often so browser storage is never the only holder of a
        user's converted work.
      </p>
      <Phase2SpikeChecks />
    </section>
  )
}
