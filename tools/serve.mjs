import path from 'node:path'

const root = path.resolve(import.meta.dir, '..')

Bun.serve({
  port: Number(process.env.PORT || 5173),
  async fetch(req) {
    const url = new URL(req.url)
    const rel = url.pathname === '/' ? '/index.html' : url.pathname
    const file = Bun.file(path.join(root, decodeURIComponent(rel)))
    if (!(await file.exists())) return new Response('not found', { status: 404 })
    return new Response(file)
  },
})

console.log('joule-lab → http://localhost:' + (process.env.PORT || 5173))
