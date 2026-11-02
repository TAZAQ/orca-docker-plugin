// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import App from '../src/panel/App.vue'
import { createHostBridge, type HostBridge, type WorkspaceContext } from '../src/panel/bridge'
import { SEND_TEXT_REQUEST } from '../src/shared/protocol'

function fakeHost(context: WorkspaceContext) {
  const sent: { terminalId: string; text: string; enter: boolean }[] = []
  const host: HostBridge = {
    readContext: vi.fn(async () => context),
    sendText: vi.fn(async (terminalId: string, text: string, enter: boolean) => {
      sent.push({ terminalId, text, enter })
      return true
    })
  }
  return { host, sent }
}

const workspace = { displayName: 'medods', branch: 'develop', terminals: [{ id: 't-1' }, { id: 't-2' }] }

describe('panel', () => {
  it('types Start All into the first terminal', async () => {
    const { host, sent } = fakeHost(workspace)
    const wrapper = mount(App, { props: { host } })
    await flushPromises()
    expect(wrapper.text()).toContain('medods')
    await wrapper.get('[data-test="project-up"]').trigger('click')
    await flushPromises()
    expect(sent).toEqual([{ terminalId: 't-1', text: 'docker compose up -d', enter: true }])
    expect(wrapper.get('[data-test="last-command"]').text()).toBe('docker compose up -d')
  })

  it('needs a second click before Down', async () => {
    const { host, sent } = fakeHost(workspace)
    const wrapper = mount(App, { props: { host } })
    await flushPromises()
    const down = wrapper.get('[data-test="project-down"]')
    await down.trigger('click')
    expect(sent).toEqual([])
    expect(down.text()).toBe('Confirm Down')
    await down.trigger('click')
    await flushPromises()
    expect(sent.map((item) => item.text)).toEqual(['docker compose down'])
  })

  it('applies compose options and service actions to the chosen terminal', async () => {
    const { host, sent } = fakeHost(workspace)
    const wrapper = mount(App, { props: { host } })
    await flushPromises()
    await wrapper.get('[data-test="terminal"]').setValue('t-2')
    await wrapper.get('[data-test="project-name"]').setValue('brave')
    await wrapper.get('[data-test="files"]').setValue('compose.yml, dev.yml')
    await wrapper.get('[data-test="run-immediately"]').setValue(false)
    expect(wrapper.get('[data-test="service-logs"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-test="service"]').setValue('postgres')
    await wrapper.get('[data-test="service-logs"]').trigger('click')
    await flushPromises()
    expect(sent).toEqual([
      {
        terminalId: 't-2',
        text: 'docker compose -p brave -f compose.yml -f dev.yml logs -f --tail 200 postgres',
        enter: false
      }
    ])
  })

  it('disables actions without a terminal', async () => {
    const { host } = fakeHost({ ...workspace, terminals: [] })
    const wrapper = mount(App, { props: { host } })
    await flushPromises()
    expect(wrapper.get('[data-test="project-up"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Open a terminal in this worktree')
  })

  it('shows a host error', async () => {
    const { host } = fakeHost(workspace)
    host.sendText = vi.fn(async () => {
      throw new Error('terminal not found')
    })
    const wrapper = mount(App, { props: { host } })
    await flushPromises()
    await wrapper.get('[data-test="project-stop"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-test="status"]').text()).toBe('terminal not found')
  })
})

describe('createHostBridge', () => {
  function fakeOrca() {
    return {
      host: { call: vi.fn(async (): Promise<unknown> => workspace) },
      plugin: { request: vi.fn(async (): Promise<unknown> => ({ accepted: true })) }
    }
  }

  it('reads the context through the frame API', async () => {
    const orca = fakeOrca()
    await expect(createHostBridge(orca).readContext()).resolves.toEqual(workspace)
    expect(orca.host.call).toHaveBeenCalledWith('workspace.readContext')
  })

  it('asks the worker to type, because panels may not call terminal.sendText', async () => {
    const orca = fakeOrca()
    await expect(createHostBridge(orca).sendText('t-1', 'docker compose ps', true)).resolves.toBe(true)
    expect(orca.plugin.request).toHaveBeenCalledWith(SEND_TEXT_REQUEST, {
      terminalId: 't-1',
      text: 'docker compose ps',
      enter: true
    })
    expect(orca.host.call).not.toHaveBeenCalled()
  })

  it('passes a worker failure on to the caller', async () => {
    const orca = fakeOrca()
    orca.plugin.request.mockRejectedValue(Object.assign(new Error('worker is down'), { code: 'unavailable' }))
    await expect(createHostBridge(orca).sendText('t-1', 'x', true)).rejects.toMatchObject({
      code: 'unavailable',
      message: 'worker is down'
    })
  })
})
