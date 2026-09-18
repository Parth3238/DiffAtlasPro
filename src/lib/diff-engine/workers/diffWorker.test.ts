import { afterEach, describe, expect, it, vi } from 'vitest'
import './diffWorker.ts'
import type { DiffWorkerResponse } from './diffWorker.ts'

function send(message: unknown): DiffWorkerResponse[] {
  const postMessage = vi.fn()
  const previous = globalThis.postMessage
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).postMessage = postMessage
  try {
    const handler = globalThis.onmessage as unknown as (event: { data: unknown }) => void
    handler({ data: message })
  } finally {
    if (previous === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).postMessage
    } else {
      globalThis.postMessage = previous
    }
  }
  return postMessage.mock.calls.map((call) => call[0] as DiffWorkerResponse)
}

describe('diffWorker message protocol', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('runs the JSON plugin and posts back the DiffResult', () => {
    const [response] = send({
      id: 1,
      fileType: 'json',
      original: '{"a":1}',
      modified: '{"a":2}',
    })
    expect(response.id).toBe(1)
    expect(response.error).toBeUndefined()
    expect(response.result).toMatchObject({ pluginId: 'json', status: 'ok' })
    expect(response.result?.changes).toEqual([
      { path: 'a', type: 'modified', oldValue: 1, newValue: 2 },
    ])
  })

  it('runs the CSV plugin and posts back the DiffResult', () => {
    const [response] = send({
      id: 2,
      fileType: 'csv',
      original: 'id,name\n1,Ann\n',
      modified: 'id,name\n1,Ann2\n',
    })
    expect(response.id).toBe(2)
    expect(response.result).toMatchObject({ pluginId: 'csv', status: 'ok' })
    expect(
      response.result?.changes.some(
        (c) => c.path === 'row[0].name' && c.type === 'modified',
      ),
    ).toBe(true)
  })

  it('posts back an error for an unregistered file type', () => {
    const [response] = send({ id: 3, fileType: 'toml', original: 'a', modified: 'b' })
    expect(response).toEqual({ id: 3, error: expect.stringContaining('toml') })
  })

  it('routes YAML payloads to the YAML plugin', () => {
    const [response] = send({
      id: 4,
      fileType: 'yaml',
      original: 'name: old\n',
      modified: 'name: new\n',
    })
    expect(response.id).toBe(4)
    expect(response.result).toMatchObject({ pluginId: 'yaml', status: 'ok' })
    expect(response.result?.changes).toEqual([
      { path: 'name', type: 'modified', oldValue: 'old', newValue: 'new' },
    ])
  })
})
