import { readFile, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'

import type { FastifyInstance } from 'fastify'

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

async function readableFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

export function registerBuiltClient(
  app: FastifyInstance,
  clientDistPath: string,
): void {
  const root = resolve(clientDistPath)
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/') || request.url === '/health') {
      return reply.code(404).send({
        error: { code: 'not_found', message: 'Route not found.' },
      })
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return reply.code(404).send({
        error: { code: 'not_found', message: 'Route not found.' },
      })
    }

    let pathname: string
    try {
      pathname = decodeURIComponent(request.url.split('?')[0] ?? '/')
    } catch {
      return reply.code(400).send({
        error: { code: 'invalid_path', message: 'Request path is invalid.' },
      })
    }
    const relative = pathname.replace(/^\/+/, '')
    const candidate = resolve(root, relative)
    if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
      return reply.code(404).send({
        error: { code: 'not_found', message: 'Route not found.' },
      })
    }

    const selected =
      relative.length > 0 && (await readableFile(candidate))
        ? candidate
        : resolve(root, 'index.html')
    if (!(await readableFile(selected))) {
      return reply.code(404).send({
        error: { code: 'client_not_built', message: 'Built client not found.' },
      })
    }

    reply.type(contentTypes[extname(selected).toLowerCase()] ?? 'application/octet-stream')
    if (request.method === 'HEAD') {
      return reply.send()
    }
    return reply.send(await readFile(selected))
  })
}
