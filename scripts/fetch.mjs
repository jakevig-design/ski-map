// Downloads a source file into .cache/ once; later runs reuse it.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const CACHE = fileURLToPath(new URL('../.cache/', import.meta.url))

export async function cached(name, url) {
  mkdirSync(CACHE, { recursive: true })
  const file = join(CACHE, name)
  if (!existsSync(file)) {
    console.log(`downloading ${url}`)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
    writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  }
  return file
}
