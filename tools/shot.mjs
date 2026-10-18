import { chromium } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'

const root = path.resolve(import.meta.dir, '..')
const url = 'file://' + path.join(root, 'index.html')
const out = path.join(root, 'shots')
fs.mkdirSync(out, { recursive: true })

const browser = await chromium.launch({
  executablePath: '/snap/chromium/current/usr/lib/chromium-browser/chrome',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
})

const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })
const problems = []
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') problems.push(m.type() + ': ' + m.text())
})
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message))

const hud = () => page.evaluate(() => ({
  q: document.querySelector('#q-val').textContent,
  p: document.querySelector('#p-val').textContent,
  t: document.querySelector('#t-val').textContent,
  time: document.querySelector('#time-val').textContent,
  formula: document.querySelector('#formula-now').textContent,
  bar: document.querySelector('#p-bar').style.width,
  paused: window.__joule.state.paused,
}))

async function setParams(i, r, secs) {
  await page.evaluate(({ i, r, secs }) => {
    const iEl = document.querySelector('#i')
    const rEl = document.querySelector('#r')
    iEl.value = String(i)
    rEl.value = String(r)
    iEl.dispatchEvent(new Event('input', { bubbles: true }))
    rEl.dispatchEvent(new Event('input', { bubbles: true }))
    if (secs) window.__joule.step(secs)
  }, { i, r, secs })
  await page.waitForTimeout(2600)
}

await page.goto(url, { waitUntil: 'load' })
await page.waitForTimeout(2200)
await page.screenshot({ path: path.join(out, '01-cool.png') })
console.log('cool', JSON.stringify(await hud()))

await setParams(5, 8, 25)
await page.screenshot({ path: path.join(out, '02-hot.png') })
console.log('hot', JSON.stringify(await hud()))

await page.evaluate(() => window.__joule.reset())
await setParams(3.2, 5.5, 22)
await page.screenshot({ path: path.join(out, '03-warm.png') })
console.log('warm', JSON.stringify(await hud()))

// pause must freeze the clock
await page.evaluate(() => document.querySelector('#play').click())
const before = await hud()
await page.waitForTimeout(1200)
const after = await hud()
console.log('paused', JSON.stringify({ before: before.time, after: after.time, paused: after.paused }))

// reset must zero the counters
await page.evaluate(() => document.querySelector('#reset').click())
console.log('reset', JSON.stringify(await hud()))

// P = I^2 R check
await page.evaluate(() => {
  document.querySelector('#play').click()
})
await setParams(4, 2, 0)
console.log('power-check', JSON.stringify(await hud()))

// laptop viewport
await page.setViewportSize({ width: 1366, height: 768 })
await page.waitForTimeout(1200)
await page.screenshot({ path: path.join(out, '04-laptop.png') })

// phone viewport
await page.setViewportSize({ width: 420, height: 900 })
await page.waitForTimeout(1200)
await page.screenshot({ path: path.join(out, '05-mobile.png') })

console.log('problems', JSON.stringify(problems))
await browser.close()
console.log('done')
