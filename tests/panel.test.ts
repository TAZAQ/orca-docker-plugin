// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import App from '../src/panel/App.vue'
import { createHostBridge, type HostBridge, type WorkspaceContext } from '../src/panel/bridge'
import { emptyTree, SEND_TEXT_REQUEST, type DockerTree, type LogsPayload } from '../src/shared/protocol'

const container = {
  id: 'abc',
  name: 'shop-web-1',
  image: 'nginx',
  state: 'running',
  status: 'Up 5 days',
  health: null,
  ports: ['8080→80']
}
const tree: DockerTree = {
  ...emptyTree(),
  projects: [
    { name: 'shop', configFiles: ['/srv/shop/compose.yaml'], services: [{ name: 'web', containers: [container] }] }
  ],
  containers: [container],
  images: [{ id: 'sha256:1', name: 'nginx:1', tags: ['nginx:1'], size: 52_000_000 }],
  networks: [{ id: 'n1', name: 'bridge', driver: 'bridge' }],
  volumes: [{ name: 'pgdata', driver: 'local' }]
}
const treeListeners: ((value: DockerTree | null) => void)[] = []
const logListeners: ((payload: LogsPayload) => void)[] = []

function fakeHost(context: WorkspaceContext) {
  const sent: { terminalId: string; text: string; enter: boolean }[] = []
  const host: HostBridge = {
    readContext: vi.fn(async () => context),
    sendText: vi.fn(async (terminalId: string, text: string, enter: boolean) => {
      sent.push({ terminalId, text, enter })
      return true
    }),
    loadTree: vi.fn(async () => tree),
    containerAction: vi.fn(async () => undefined),
    startLogs: vi.fn(async () => 'stream-1'),
    renewLogs: vi.fn(async () => true),
    stopLogs: vi.fn(async () => undefined),
    onLogs: vi.fn((listener: (payload: LogsPayload) => void) => {
      logListeners.push(listener)
      return { dispose: () => undefined }
    }),
    onTreeChanged: vi.fn((listener: (value: DockerTree | null) => void) => {
      treeListeners.push(listener)
      return { dispose: () => undefined }
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

  async function mountWithProject(context: WorkspaceContext = workspace) {
    const { host, sent } = fakeHost(context)
    const wrapper = mount(App, { props: { host } })
    await flushPromises()
    await wrapper.get('[data-test="project-row-shop"]').trigger('click')
    return { host, sent, wrapper }
  }

  it('lays the tree out like the JetBrains Docker node, with every group collapsed', async () => {
    const { host } = fakeHost(workspace)
    const wrapper = mount(App, { props: { host } })
    await flushPromises()
    const labels = wrapper.findAll('[data-test="tree"] > li > ul > li > button .name').map((row) => row.text())
    expect(labels).toEqual([
      'Docker-compose: shop',
      'Dev Containers',
      'Containers',
      'Images',
      'Networks',
      'Volumes'
    ])
    expect(wrapper.find('[data-test="service-row-shop-web"]').exists()).toBe(false)
  })

  it('expands images, networks and volumes', async () => {
    const { host } = fakeHost(workspace)
    const wrapper = mount(App, { props: { host } })
    await flushPromises()
    for (const group of ['images', 'networks', 'volumes']) {
      await wrapper.get(`[data-test="group-${group}"]`).trigger('click')
    }
    const text = wrapper.get('[data-test="tree"]').text()
    expect(text).toContain('nginx:1')
    expect(text).toContain('52 MB')
    expect(text).toContain('bridge')
    expect(text).toContain('pgdata')
  })

  it('collapses the whole Docker node', async () => {
    const { host } = fakeHost(workspace)
    const wrapper = mount(App, { props: { host } })
    await flushPromises()
    await wrapper.get('[data-test="group-docker"]').trigger('click')
    expect(wrapper.find('[data-test="group-images"]').exists()).toBe(false)
  })

  it('follows what the worker pushes', async () => {
    const { host } = fakeHost(workspace)
    const wrapper = mount(App, { props: { host } })
    await flushPromises()
    treeListeners.at(-1)!({ ...emptyTree(), projects: [{ ...tree.projects[0]!, name: 'other' }] })
    await flushPromises()
    expect(wrapper.get('[data-test="tree"]').text()).toContain('Docker-compose: other')
    expect(wrapper.get('[data-test="tree"]').text()).not.toContain('Docker-compose: shop')
  })

  it('asks for the tree when the worker says it is too big to post', async () => {
    const { host } = fakeHost(workspace)
    mount(App, { props: { host } })
    await flushPromises()
    treeListeners.at(-1)!(null)
    await flushPromises()
    expect(host.loadTree).toHaveBeenCalledTimes(2)
  })

  it('searches the tree, opens what it found and hides the rest', async () => {
    const { host } = fakeHost(workspace)
    const wrapper = mount(App, { props: { host } })
    await flushPromises()
    await wrapper.get('[data-test="tree-search"]').setValue('WEB')
    const text = wrapper.get('[data-test="tree"]').text()
    expect(text).toContain('Docker-compose: shop')
    expect(wrapper.find('[data-test="service-row-shop-web"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="group-images"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="group-volumes"]').exists()).toBe(false)
  })

  it('says when the search found nothing and clears on Escape', async () => {
    const { host } = fakeHost(workspace)
    const wrapper = mount(App, { props: { host } })
    await flushPromises()
    const search = wrapper.get('[data-test="tree-search"]')
    await search.setValue('nothing-like-this')
    expect(wrapper.find('[data-test="tree-no-matches"]').exists()).toBe(true)
    await search.trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[data-test="tree-no-matches"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="group-images"]').exists()).toBe(true)
  })

  it('points the service section at the clicked service', async () => {
    const { sent, wrapper } = await mountWithProject()
    await wrapper.get('[data-test="service-row-shop-web"]').trigger('click')
    await wrapper.get('[data-test="service-restart"]').trigger('click')
    await flushPromises()
    expect(sent[0]!.text).toBe('docker compose -p shop -f /srv/shop/compose.yaml restart web')
  })

  it('runs container actions through the worker, not a terminal', async () => {
    const { host, sent, wrapper } = await mountWithProject({ ...workspace, terminals: [] })
    await wrapper.get('[data-test="action-stop"]').trigger('click')
    await flushPromises()
    expect(host.containerAction).toHaveBeenCalledWith('abc', 'stop')
    expect(sent).toEqual([])
    expect(wrapper.get('[data-test="status"]').text()).toBe('shop-web-1: stop done')
  })

  it('offers start and remove only for a stopped container, and remove needs a second click', async () => {
    const { host, wrapper } = await mountWithProject()
    expect(wrapper.find('[data-test="action-remove"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="action-start"]').exists()).toBe(false)
    const stopped = { ...container, state: 'exited', status: 'Exited (0)' }
    treeListeners.at(-1)!({
      ...tree,
      projects: [{ ...tree.projects[0]!, services: [{ name: 'web', containers: [stopped] }] }]
    })
    await flushPromises()
    expect(wrapper.find('[data-test="action-stop"]').exists()).toBe(false)
    const remove = wrapper.get('[data-test="action-remove"]')
    await remove.trigger('click')
    expect(host.containerAction).not.toHaveBeenCalled()
    await remove.trigger('click')
    expect(host.containerAction).toHaveBeenCalledWith('abc', 'remove')
  })

  it('opens a shell in the chosen terminal by the container name', async () => {
    const { sent, wrapper } = await mountWithProject()
    await wrapper.get('[data-test="action-shell"]').trigger('click')
    await flushPromises()
    expect(sent[0]).toEqual({ terminalId: 't-1', text: 'docker exec -it shop-web-1 sh', enter: true })
  })

  it('shows a failed container action', async () => {
    const { host, wrapper } = await mountWithProject()
    host.containerAction = vi.fn(async () => {
      throw new Error('no such container')
    })
    await wrapper.setProps({ host })
    await wrapper.get('[data-test="action-restart"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-test="status"]').text()).toBe('no such container')
  })

  it('shows logs in the panel and stops the stream when closed', async () => {
    const { host, wrapper } = await mountWithProject()
    await wrapper.get('[data-test="action-logs"]').trigger('click')
    await flushPromises()
    expect(host.startLogs).toHaveBeenCalledWith('abc')
    logListeners.at(-1)!({ streamId: 'stream-1', kind: 'text', text: 'first\nsec' })
    logListeners.at(-1)!({ streamId: 'other', kind: 'text', text: 'not for us\n' })
    logListeners.at(-1)!({ streamId: 'stream-1', kind: 'text', text: 'ond\n' })
    await flushPromises()
    expect(wrapper.get('[data-test="logs"]').text()).toBe('first\nsecond')
    await wrapper.get('[data-test="logs-close"]').trigger('click')
    await flushPromises()
    expect(host.stopLogs).toHaveBeenCalledWith('stream-1')
    expect(wrapper.find('[data-test="logs"]').exists()).toBe(false)
  })

  it('filters log lines and says when the stream ended', async () => {
    const { wrapper } = await mountWithProject()
    await wrapper.get('[data-test="action-logs"]').trigger('click')
    await flushPromises()
    logListeners.at(-1)!({ streamId: 'stream-1', kind: 'text', text: 'alpha\nbeta\n' })
    logListeners.at(-1)!({ streamId: 'stream-1', kind: 'ended', error: 'daemon went away' })
    await flushPromises()
    await wrapper.get('[data-test="logs-filter"]').setValue('BET')
    expect(wrapper.get('[data-test="logs"]').text()).toBe('beta')
    expect(wrapper.get('[data-test="logs-ended"]').text()).toContain('daemon went away')
  })

  it('shows why the tree is unavailable', async () => {
    const { host } = fakeHost(workspace)
    host.loadTree = vi.fn(async () => {
      throw new Error('worker is down')
    })
    const wrapper = mount(App, { props: { host } })
    await flushPromises()
    expect(wrapper.get('[data-test="tree-error"]').text()).toBe('worker is down')
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
      plugin: {
        request: vi.fn(async (): Promise<unknown> => ({ accepted: true })),
        on: vi.fn(() => ({ dispose: () => undefined }))
      }
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
