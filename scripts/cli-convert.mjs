import fs from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright-core'
import { parseArgs } from 'node:util'

function parseTopicsText(text) {
  const lines = text.split(/\r?\n/)
  const topics = []
  let currentTopic = null

  for (const line of lines) {
    if (!line.trim()) continue
    const isSubtopic = line.startsWith(' ') || line.startsWith('\t')
    const content = line.trim()
    if (isSubtopic) {
      if (currentTopic) {
        currentTopic.subtopics.push(content)
      } else {
        currentTopic = { topic: content, subtopics: [] }
        topics.push(currentTopic)
      }
    } else {
      currentTopic = { topic: content, subtopics: [] }
      topics.push(currentTopic)
    }
  }
  return topics
}

async function launchBrowser() {
  const launchOptions = { headless: true }
  
  // Try default Playwright Chromium first
  try {
    return await chromium.launch(launchOptions)
  } catch (err) {
    // Try Microsoft Edge channel
    try {
      return await chromium.launch({ ...launchOptions, channel: 'msedge' })
    } catch (err2) {
      // Try Windows default path for Microsoft Edge
      const EDGE_PATH = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
      try {
        return await chromium.launch({ ...launchOptions, executablePath: EDGE_PATH })
      } catch (err3) {
        throw new Error(
          'Could not launch a headless browser. Please ensure that Microsoft Edge is installed, ' +
          'or run `npx playwright install chromium` to install Chromium.'
        )
      }
    }
  }
}

async function main() {
  const options = {
    key: { type: 'string', short: 'k' },
    out: { type: 'string', short: 'o' },
    'answer-key': { type: 'string', short: 'a' },
    year: { type: 'string', short: 'y' },
    topics: { type: 'string', short: 't' },
    help: { type: 'boolean', short: 'h' },
  }

  const { values, positionals } = parseArgs({ options, allowPositionals: true })

  if (values.help || positionals.length === 0) {
    console.log(`
Codox PDF-to-CSV Headless CLI Converter

Usage:
  node scripts/cli-convert.mjs <input-pdf-path> [options]

Arguments:
  <input-pdf-path>           Path to the exam PDF file.

Options:
  -k, --key <gemini-key>      Your Google Gemini API key. Defaults to GEMINI_API_KEY env var.
  -o, --out <output-dir>      Directory where the output folder will be written. Defaults to current directory.
  -a, --answer-key <pdf>      Path to a separate answer-key PDF (optional).
  -y, --year <year>           Override the year value to be stamped on all questions (optional).
  -t, --topics <topics-file>  Path to a JSON or indented text topics list file (optional).
  -h, --help                  Show this help message.

Examples:
  node scripts/cli-convert.mjs exam.pdf --key AIzaSy...
  node scripts/cli-convert.mjs exam.pdf -a key.pdf -o ./output/
`)
    process.exit(0)
  }

  const pdfPath = path.resolve(positionals[0])
  const pdfName = path.basename(pdfPath, '.pdf')
  
  console.log(`Reading exam PDF: ${pdfPath}...`)
  const examBytes = await fs.readFile(pdfPath)

  const apiKey = values.key || process.env.GEMINI_API_KEY
  if (!apiKey) {
    console.error('Error: Google Gemini API key is required. Specify it with --key or the GEMINI_API_KEY environment variable.')
    process.exit(1)
  }

  let answerKeyBytes = null
  let answerKeyName = ''
  if (values['answer-key']) {
    const akPath = path.resolve(values['answer-key'])
    console.log(`Reading answer key PDF: ${akPath}...`)
    answerKeyBytes = await fs.readFile(akPath)
    answerKeyName = path.basename(akPath)
  }

  let topicsList = null
  if (values.topics) {
    const topicsPath = path.resolve(values.topics)
    console.log(`Reading topics file: ${topicsPath}...`)
    const topicsContent = await fs.readFile(topicsPath, 'utf8')
    if (topicsContent.trim().startsWith('[')) {
      topicsList = JSON.parse(topicsContent)
    } else {
      topicsList = parseTopicsText(topicsContent)
    }
  }

  const outputDir = values.out ? path.resolve(values.out) : process.cwd()

  let server = null
  let browser = null

  try {
    console.log('Starting Vite server programmatically...')
    server = await createServer({
      server: {
        port: 0,
        strictPort: true,
      },
      plugins: [{
        name: 'cli-file-server',
        configureServer(srv) {
          srv.middlewares.use('/cli-files/exam.pdf', (req, res) => {
            res.setHeader('Content-Type', 'application/pdf')
            res.end(examBytes)
          })
          if (answerKeyBytes) {
            srv.middlewares.use('/cli-files/key.pdf', (req, res) => {
              res.setHeader('Content-Type', 'application/pdf')
              res.end(answerKeyBytes)
            })
          }
        }
      }]
    })

    await server.listen()
    const port = server.config.server.port
    const url = `http://localhost:${port}`
    console.log(`Vite server running at ${url}`)

    console.log('Launching headless browser...')
    browser = await launchBrowser()
    const page = await browser.newPage()

    page.on('console', msg => {
      const text = msg.text()
      if (text.startsWith('[PROGRESS]')) {
        console.log(text.replace('[PROGRESS] ', ''))
      } else if (msg.type() === 'error') {
        console.error('Browser console error:', text)
      }
    })

    page.on('pageerror', err => {
      console.error('Browser runtime error:', err.message)
    })

    console.log(`Loading application page at ${url}...`)
    await page.goto(url)

    console.log('Starting conversion process in browser...')
    const result = await page.evaluate(async ({
      apiKey,
      examName,
      hasAnswerKey,
      answerKeyName,
      year,
      topicsList
    }) => {
      try {
        const { db } = await import('/src/state/db.ts')
        await db.runs.clear()
        await db.runArtifacts.clear()
        await db.files.clear()
        await db.logs.clear()

        const { saveGeminiKey } = await import('/src/state/credentials.ts')
        const { createRun, getRun, putArtifact } = await import('/src/state/runs.ts')
        const { executeRun } = await import('/src/engine/executor.ts')
        const { readPdfInfo } = await import('/src/pdf/index.ts')
        const { bytesToBase64 } = await import('/src/providers/base64.ts')

        // Save key
        await saveGeminiKey(apiKey)

        // Fetch files from custom dev endpoints
        const examRes = await fetch('/cli-files/exam.pdf')
        const examBytes = new Uint8Array(await examRes.arrayBuffer())
        const examPageCount = (await readPdfInfo(examBytes)).pageCount

        const jobId = 'cli-job'
        const examId = 'cli-exam'

        await db.files.put({
          id: examId,
          jobId,
          name: examName,
          size: examBytes.length,
          pageCount: examPageCount,
          blob: new Blob([examBytes], { type: 'application/pdf' }),
          kind: 'exam',
          addedAt: Date.now()
        })

        let answerKeyPdfId = undefined
        let answerKeyBytes = undefined
        let answerKeyPageCount = 0

        if (hasAnswerKey) {
          answerKeyPdfId = 'cli-answer-key'
          const akRes = await fetch('/cli-files/key.pdf')
          answerKeyBytes = new Uint8Array(await akRes.arrayBuffer())
          answerKeyPageCount = (await readPdfInfo(answerKeyBytes)).pageCount

          await db.files.put({
            id: answerKeyPdfId,
            jobId,
            name: answerKeyName,
            size: answerKeyBytes.length,
            pageCount: answerKeyPageCount,
            blob: new Blob([answerKeyBytes], { type: 'application/pdf' }),
            kind: 'answer-key',
            addedAt: Date.now()
          })
        }

        if (topicsList && topicsList.length > 0) {
          await db.jobs.put({
            id: jobId,
            createdAt: Date.now(),
            step: 'convert',
            topics: topicsList
          })
        }

        const runId = await createRun({
          jobId,
          pdfId: examId,
          answerKeyPdfId,
          fileName: examName,
          pageCount: examPageCount + answerKeyPageCount,
          yearMode: year ? 'type' : 'ai',
          ...(year ? { typedYear: year } : {})
        })

        if (topicsList && topicsList.length > 0) {
          await putArtifact({ runId, kind: 'topics-list', json: { topics: topicsList } })
        }

        let lastProgress = ''
        const interval = setInterval(async () => {
          try {
            const run = await db.runs.get(runId)
            if (!run) return

            let str = ''
            if (run.step === 'render') {
              str = `Rendering pages: ${run.pagesRendered ?? 0}/${run.pageCount ?? 0}`
            } else if (run.step === 'planner') {
              str = `Planning: Window ${run.plannerWindowsDone ?? 0}/${run.plannerWindowCount ?? 0}`
            } else if (run.step === 'crops') {
              str = `Cropping visual assets...`
            } else if (run.step === 'worker') {
              str = `Extracting questions: Chunk ${run.chunksDone ?? 0}/${run.chunkCount ?? 0}`
            } else if (run.step === 'merge') {
              str = `Merging results...`
            } else if (run.step === 'emit') {
              str = `Validating and emitting CSV...`
            } else if (run.step === 'audit') {
              str = `Running audit check...`
            }

            if (str && str !== lastProgress) {
              lastProgress = str
              console.log(`[PROGRESS] ${str}`)
            }
          } catch (e) {}
        }, 500)

        const outcome = await executeRun(runId, examBytes, {
          examPageCount,
          answerKeyBytes: answerKeyBytes || undefined,
          answerKeyPageCount,
        })

        clearInterval(interval)

        if (outcome.status === 'stopped') {
          return { success: false, error: `Execution stopped: ${outcome.reason}` }
        } else if (outcome.status === 'provider-stopped') {
          return { success: false, error: `Provider stopped: ${outcome.kind}` }
        }

        const crops = await db.runArtifacts.where('[runId+kind]').equals([runId, 'crop']).toArray()
        const cropList = crops.map(c => ({
          path: c.path,
          base64: bytesToBase64(c.bytes)
        }))

        // Custom CSV projection for CLI: options, question, correct_index, image_url
        const { csvLine } = await import('/src/engine/csv.ts')
        const mergedRowsArtifact = await db.runArtifacts.where('[runId+kind]').equals([runId, 'merged-rows']).first()
        const mergedRows = mergedRowsArtifact ? mergedRowsArtifact.json : []

        const headers = ['options', 'question', 'correct_index', 'image_url']
        const csvLines = [csvLine(headers)]
        for (const row of mergedRows) {
          const imageUrl = row.image_urls && row.image_urls.length > 0 ? row.image_urls[0] : ''
          csvLines.push(
            csvLine([
              JSON.stringify(row.options),
              row.question,
              row.correct_index,
              imageUrl
            ])
          )
        }
        const customCsv = csvLines.join('\r\n') + '\r\n'

        const blueprintArtifact = await db.runArtifacts.where('[runId+kind]').equals([runId, 'blueprint-valid']).first()
        const rawBlueprintArtifact = await db.runArtifacts.where('[runId+kind]').equals([runId, 'blueprint-raw']).first()
        const logs = await db.logs.where('runId').equals(runId).toArray()
        const allArtifacts = await db.runArtifacts.where('runId').equals(runId).toArray()
        const serializedArtifacts = allArtifacts
          .filter(a => a.kind !== 'crop' && a.kind !== 'page-jpeg')
          .map(a => ({
            kind: a.kind,
            chunkIndex: a.chunkIndex,
            text: a.text,
            json: a.json
          }))

        const pageJpegs = await db.runArtifacts.where('kind').equals('page-jpeg').toArray()
        const pagesData = pageJpegs.map(p => {
          let binary = '';
          const bytes = p.bytes;
          const len = bytes.byteLength;
          for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          return {
            pageIndex: p.pageIndex,
            base64: btoa(binary)
          };
        })

        return {
          success: true,
          csv: customCsv,
          flaggedRows: outcome.flaggedRows,
          notSafeToImport: outcome.notSafeToImport,
          crops: cropList,
          blueprint: blueprintArtifact ? blueprintArtifact.json : null,
          rawBlueprint: rawBlueprintArtifact ? rawBlueprintArtifact.text : null,
          logs: logs,
          artifacts: serializedArtifacts,
          pagesData: pagesData
        }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }, {
      apiKey,
      examName: pdfName,
      hasAnswerKey: answerKeyBytes !== null,
      answerKeyName,
      year: values.year,
      topicsList
    })

    if (!result.success) {
      console.error(`\nError: Conversion failed. ${result.error}`)
      process.exit(1)
    }

    const bundleDirName = `${pdfName} Cx`
    const bundlePath = path.join(outputDir, bundleDirName)
    await fs.mkdir(bundlePath, { recursive: true })

    const csvPath = path.join(bundlePath, `${bundleDirName}.csv`)
    await fs.writeFile(csvPath, result.csv, 'utf8')
    console.log(`\nSuccessfully saved CSV to: ${csvPath}`)

    const debugPath = path.join(bundlePath, 'debug')
    await fs.mkdir(debugPath, { recursive: true })
    if (result.blueprint) {
      await fs.writeFile(path.join(debugPath, 'blueprint-valid.json'), JSON.stringify(result.blueprint, null, 2), 'utf8')
    }
    if (result.rawBlueprint) {
      await fs.writeFile(path.join(debugPath, 'blueprint-raw.json'), result.rawBlueprint, 'utf8')
    }
    if (result.logs) {
      await fs.writeFile(path.join(debugPath, 'execution-logs.json'), JSON.stringify(result.logs, null, 2), 'utf8')
    }
    if (result.artifacts && result.artifacts.length > 0) {
      const artifactsPath = path.join(debugPath, 'artifacts')
      await fs.mkdir(artifactsPath, { recursive: true })
      for (const a of result.artifacts) {
        const name = `${a.kind}${a.chunkIndex !== undefined ? `-${a.chunkIndex}` : ''}.json`
        const content = a.text !== undefined ? a.text : (a.json !== undefined ? JSON.stringify(a.json, null, 2) : '{}')
        await fs.writeFile(path.join(artifactsPath, name), content, 'utf8')
      }
    }
    if (result.pagesData && result.pagesData.length > 0) {
      const pagesPath = path.join(debugPath, 'pages')
      await fs.mkdir(pagesPath, { recursive: true })
      for (const p of result.pagesData) {
        await fs.writeFile(path.join(pagesPath, `page-${p.pageIndex + 1}.jpg`), Buffer.from(p.base64, 'base64'))
      }
    }
    console.log(`Debug files saved to: ${debugPath}`)

    if (result.crops.length > 0) {
      console.log(`Saving ${result.crops.length} visual crop assets...`)
      for (const crop of result.crops) {
        const cropOutPath = path.join(bundlePath, crop.path)
        await fs.mkdir(path.dirname(cropOutPath), { recursive: true })
        await fs.writeFile(cropOutPath, Buffer.from(crop.base64, 'base64'))
      }
      console.log(`Crops successfully saved inside: ${path.join(bundlePath, 'images')}`)
    }

    console.log(`\nConversion complete! Flagged rows for review: ${result.flaggedRows}. Safe to import: ${!result.notSafeToImport ? 'Yes' : 'No'}`)
  } finally {
    if (browser) {
      console.log('Closing headless browser...')
      await browser.close()
    }
    if (server) {
      console.log('Stopping Vite server...')
      await server.close()
    }
  }
}

main().catch(console.error)
