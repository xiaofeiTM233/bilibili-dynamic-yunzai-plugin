/**
 * Yunzai 模块桩：拦截 ../../../lib/plugins/plugin.js 导入
 */
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const stub = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'plugin-stub.js')).href

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('lib/plugins/plugin.js')) {
    return { url: stub, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
