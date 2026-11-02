// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import App from '../src/panel/App.vue'
import { createHostBridge, type HostBridge, type WorkspaceContext } from '../src/panel/bridge'
import { emptyTree, OPEN_TERMINAL_REQUEST, type DockerTree, type LogsPayload, type OpenTerminalInput } from '../src/shared/protocol'

const container = {
  id: 'abc',
  name: 'shop-web-1',
  image: 'nginx',
  imageId: 'sha256:1',
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
const contextListeners: ((value: WorkspaceContext) => void)[] = []

function fakeHost(context: WorkspaceContext) {
  const sent: OpenTerminalInput[] = []
  const host: HostBridge = {
    readContext: vi.fn(async () => context),
    onContextChanged: vi.fn((listener: (value: WorkspaceContext) => void) => {
      contextListeners.push(listener)
      return { dispose: () => undefined }
    }),
    openTerminal: vi.fn(async (input: OpenTerminalInput) => {
      sent.push(input)
    }),
    loadTree: vi.fn(async () => tree),
    containerAction: vi.fn(async () => undefined),
    inspect: vi.fn(async (): Promise<unknown> => ({ Id: 'abc' })),
    processes: vi.fn(async () => ({ titles: ['PID', 'CMD'], processes: [['1', 'nginx']] })),
    files: vi.fn(async (_id: string, path: string) => `listing of ${path}`),
    removeImage: vi.fn(async () => undefined),
    previewPrune: vi.fn(async () => ({ images: [] as { name: string; size: number }[] })),
    pruneImages: vi.fn(async () => ({ removed: 2, reclaimed: 30_000_000 })),
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

const workspace = { displayName: 'medods', branch: 'develop' }

async function openLogs(wrapper: VueWrapper) {
  await wrapper.get('[data-test="service-row-shop-web"]').trigger('contextmenu')
  await menuItem(wrapper, 'Show Logs').trigger('click')
}

function menuItem(wrapper: VueWrapper, label: string) {
  const item = wrapper
    .findAll('[data-test="context-menu"] button')
    .find((button) => button.text() === label)
  if (!item) {
    throw new Error(`no menu item ${label}`)
  }
  return item
}

describe('panel', () => {




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






  it('shows logs in the panel and stops the stream when closed', async () => {
    const { host, wrapper } = await mountWithProject()
    await openLogs(wrapper)
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
    await openLogs(wrapper)
    await flushPromises()
    logListeners.at(-1)!({ streamId: 'stream-1', kind: 'text', text: 'alpha\nbeta\n' })
    logListeners.at(-1)!({ streamId: 'stream-1', kind: 'ended', error: 'daemon went away' })
    await flushPromises()
    await wrapper.get('[data-test="logs-filter"]').setValue('BET')
    expect(wrapper.get('[data-test="logs"]').text()).toBe('beta')
    expect(wrapper.get('[data-test="logs-ended"]').text()).toContain('daemon went away')
  })



  it('does not repeat a branch that is the name of the workspace', async () => {
    const { host } = fakeHost({ ...workspace, displayName: 'master', branch: 'master' })
    const wrapper = mount(App, { props: { host } })
    await flushPromises()
    expect(wrapper.find('.branch').exists()).toBe(false)
  })



  it('offers the JetBrains group menu on a compose project', async () => {
    const { sent, wrapper } = await mountWithProject()
    await wrapper.get('[data-test="project-row-shop"]').trigger('contextmenu')
    const labels = wrapper.findAll('[data-test="context-menu"] button').map((button) => button.text())
    expect(labels).toEqual([
      'Start All',
      'Deploy',
      'Restart',
      'Stop',
      'Down',
      'Pull',
      'Build',
      'Status in Terminal',
      'Logs in Terminal',
      'Jump to Source',
      'Copy Compose File Path'
    ])
    expect(menuItem(wrapper, 'Jump to Source').attributes('disabled')).toBeDefined()
    await menuItem(wrapper, 'Deploy').trigger('click')
    await flushPromises()
    expect(sent[0]!.command).toBe('docker compose -p shop -f /srv/shop/compose.yaml up -d')
    expect(wrapper.find('[data-test="context-menu"]').exists()).toBe(false)
  })



  it('rebuilds the service a container came from', async () => {
    const { sent, wrapper } = await mountWithProject()
    await wrapper.get('[data-test="service-row-shop-web"]').trigger('contextmenu')
    await menuItem(wrapper, 'Rebuild Service').trigger('click')
    await flushPromises()
    expect(sent[0]!.command).toBe('docker compose -p shop -f /srv/shop/compose.yaml up -d --build web')
  })

  it('starts a project that has no containers yet from the terminal folder', async () => {
    const { sent, wrapper } = await mountWithProject()
    await wrapper.get('[data-test="group-docker"]').trigger('contextmenu')
    await menuItem(wrapper, 'Compose Up in Workspace Folder').trigger('click')
    await flushPromises()
    expect(sent[0]!.command).toBe('docker compose up -d')
  })



  async function mountWithImages() {
    const { host, wrapper } = await mountWithProject()
    await wrapper.get('[data-test="group-images"]').trigger('click')
    return { host, wrapper }
  }

  it('warns that removing an image removes its containers, and names them', async () => {
    const { host, wrapper } = await mountWithImages()
    await wrapper.get('[data-test="image-row-nginx:1"]').trigger('contextmenu')
    await menuItem(wrapper, 'Remove Image').trigger('click')
    expect(host.removeImage).not.toHaveBeenCalled()
    expect(wrapper.get('[data-test="dialog-message"]').text()).toContain(
      'The 1 container based on this image will be removed too, even if running'
    )
    expect(wrapper.get('[data-test="dialog-items"]').text()).toContain('shop-web-1 (Up 5 days)')
    await wrapper.get('[data-test="dialog-confirm"]').trigger('click')
    await flushPromises()
    expect(host.removeImage).toHaveBeenCalledWith('sha256:1', ['abc'])
    expect(wrapper.get('[data-test="status"]').text()).toBe('nginx:1 removed')
  })

  it('removes nothing when the warning is cancelled', async () => {
    const { host, wrapper } = await mountWithImages()
    await wrapper.get('[data-test="image-row-nginx:1"]').trigger('contextmenu')
    await menuItem(wrapper, 'Remove Image').trigger('click')
    await wrapper.get('[data-test="dialog-cancel"]').trigger('click')
    await flushPromises()
    expect(host.removeImage).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="dialog"]').exists()).toBe(false)
  })

  it('offers image removal from a container too', async () => {
    const { wrapper } = await mountWithProject()
    await wrapper.get('[data-test="service-row-shop-web"]').trigger('contextmenu')
    await menuItem(wrapper, 'Image').trigger('click')
    await menuItem(wrapper, 'Remove Image').trigger('click')
    expect(wrapper.find('[data-test="dialog"]').exists()).toBe(true)
  })

  it('shows what a prune would remove and only then removes it', async () => {
    const { host, wrapper } = await mountWithProject()
    host.previewPrune = vi.fn(async () => ({
      images: [
        { name: 'old:1', size: 10_000_000 },
        { name: 'old:2', size: 20_000_000 }
      ]
    }))
    await wrapper.setProps({ host })
    await wrapper.get('[data-test="group-images"]').trigger('contextmenu')
    await menuItem(wrapper, 'Remove Unused Images').trigger('click')
    await flushPromises()
    expect(host.previewPrune).toHaveBeenCalledWith('unused')
    expect(host.pruneImages).not.toHaveBeenCalled()
    expect(wrapper.get('[data-test="dialog-message"]').text()).toContain('30 MB')
    expect(wrapper.get('[data-test="dialog-items"]').text()).toContain('old:2 (20 MB)')
    await wrapper.get('[data-test="dialog-confirm"]').trigger('click')
    await flushPromises()
    expect(host.pruneImages).toHaveBeenCalledWith('unused')
    expect(wrapper.get('[data-test="status"]').text()).toBe('Removed 2 images, freed 30 MB')
  })

  it('counts in the singular for one image', async () => {
    const { host, wrapper } = await mountWithProject()
    host.previewPrune = vi.fn(async () => ({ images: [{ name: 'old:1', size: 1_000_000 }] }))
    host.pruneImages = vi.fn(async () => ({ removed: 1, reclaimed: 1_000_000 }))
    await wrapper.setProps({ host })
    await wrapper.get('[data-test="group-images"]').trigger('contextmenu')
    await menuItem(wrapper, 'Remove Dangling Images').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-test="dialog"]').text()).toContain('Remove 1 dangling image?')
    expect(wrapper.get('[data-test="dialog-confirm"]').text()).toBe('Remove 1 image')
    await wrapper.get('[data-test="dialog-confirm"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-test="status"]').text()).toBe('Removed 1 image, freed 1 MB')
  })

  it('says there is nothing to clean instead of asking', async () => {
    const { wrapper } = await mountWithProject()
    await wrapper.get('[data-test="group-images"]').trigger('contextmenu')
    await menuItem(wrapper, 'Remove Dangling Images').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="dialog"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="status"]').text()).toBe('No dangling images to remove')
  })

  it('focuses Cancel, so Enter alone cannot confirm a removal', async () => {
    const { host } = fakeHost(workspace)
    const wrapper = mount(App, { props: { host }, attachTo: document.body })
    await flushPromises()
    await wrapper.get('[data-test="group-images"]').trigger('click')
    await wrapper.get('[data-test="image-row-nginx:1"]').trigger('contextmenu')
    await menuItem(wrapper, 'Remove Image').trigger('click')
    expect(document.activeElement).toBe(wrapper.get('[data-test="dialog-cancel"]').element)
    wrapper.unmount()
  })

  it('opens a shell in a terminal when a running container is clicked', async () => {
    const { sent, wrapper } = await mountWithProject()
    await wrapper.get('[data-test="service-row-shop-web"]').trigger('click')
    await flushPromises()
    expect(sent).toEqual([
      { title: 'shop-web-1 sh', command: 'docker exec -it shop-web-1 sh', reuseKey: 'sh:abc' }
    ])
  })

  it('opens nothing for a stopped container and says why', async () => {
    const { sent, wrapper } = await mountWithProject()
    const stopped = { ...container, state: 'exited', status: 'Exited (0)' }
    treeListeners.at(-1)!({
      ...tree,
      projects: [{ ...tree.projects[0]!, services: [{ name: 'web', containers: [stopped] }] }]
    })
    await flushPromises()
    await wrapper.get('[data-test="service-row-shop-web"]').trigger('click')
    await flushPromises()
    expect(sent).toEqual([])
    expect(wrapper.get('[data-test="status"]').text()).toBe('shop-web-1 is not running')
  })

  it('has no shortcut buttons on the rows', async () => {
    const { wrapper } = await mountWithProject()
    expect(wrapper.find('[data-test^="action-"]').exists()).toBe(false)
  })

  it('has no terminal section left', async () => {
    const { wrapper } = await mountWithProject()
    expect(wrapper.find('select').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Run immediately')
  })

  it('lights up one row, the last clicked or right-clicked', async () => {
    const { wrapper } = await mountWithProject()
    const lit = () => wrapper.findAll('.row.active').map((row) => row.attributes('data-test'))
    expect(lit()).toEqual(['project-row-shop'])
    await wrapper.get('[data-test="service-row-shop-web"]').trigger('click')
    expect(lit()).toEqual(['service-row-shop-web'])
    await wrapper.get('[data-test="group-images"]').trigger('contextmenu')
    expect(lit()).toEqual(['group-images'])
    await wrapper.get('[data-test="group-containers"]').trigger('click')
    await wrapper.get('[data-test="container-row-shop-web-1"]').trigger('click')
    expect(lit()).toEqual(['container-row-shop-web-1'])
  })

  it('offers start and removal, which asks first, for a stopped container', async () => {
    const { host, wrapper } = await mountWithProject()
    const stopped = { ...container, state: 'exited', status: 'Exited (0)' }
    treeListeners.at(-1)!({
      ...tree,
      projects: [{ ...tree.projects[0]!, services: [{ name: 'web', containers: [stopped] }] }]
    })
    await flushPromises()
    await wrapper.get('[data-test="service-row-shop-web"]').trigger('contextmenu')
    await menuItem(wrapper, 'Remove Container').trigger('click')
    expect(host.containerAction).not.toHaveBeenCalled()
    await wrapper.get('[data-test="dialog-confirm"]').trigger('click')
    expect(host.containerAction).toHaveBeenCalledWith('abc', 'remove')
  })

  it('shows a failed container action', async () => {
    const { host, wrapper } = await mountWithProject()
    host.containerAction = vi.fn(async () => {
      throw new Error('no such container')
    })
    await wrapper.setProps({ host })
    await wrapper.get('[data-test="service-row-shop-web"]').trigger('contextmenu')
    await menuItem(wrapper, 'Restart Container').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-test="status"]').text()).toBe('no such container')
  })

  it('shows a terminal that could not open', async () => {
    const { host, wrapper } = await mountWithProject()
    host.openTerminal = vi.fn(async () => {
      throw new Error('Open any terminal in this workspace first')
    })
    await wrapper.setProps({ host })
    await wrapper.get('[data-test="service-row-shop-web"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-test="status"]').text()).toBe('Open any terminal in this workspace first')
  })

  it('asks before Down from the menu', async () => {
    const { sent, wrapper } = await mountWithProject()
    await wrapper.get('[data-test="project-row-shop"]').trigger('contextmenu')
    await menuItem(wrapper, 'Down').trigger('click')
    expect(sent).toEqual([])
    await wrapper.get('[data-test="dialog-confirm"]').trigger('click')
    await flushPromises()
    expect(sent[0]!.command).toBe('docker compose -p shop -f /srv/shop/compose.yaml down')
  })

  it('offers the JetBrains container menu on a running container', async () => {
    const { host, wrapper } = await mountWithProject()
    await wrapper.get('[data-test="service-row-shop-web"]').trigger('contextmenu')
    const labels = wrapper.findAll('[data-test="context-menu"] button').map((button) => button.text())
    expect(labels).toEqual([
      'Restart Container',
      'Pause Container',
      'Stop Container',
      'Image',
      'Show Logs',
      'Show Files',
      'Copy Container ID',
      'Copy Image ID',
      'Inspect',
      'Show Processes',
      'Attach',
      'Exec',
      'Create Terminal',
      'Rebuild Service'
    ])
    await menuItem(wrapper, 'Pause Container').trigger('click')
    expect(host.containerAction).toHaveBeenCalledWith('abc', 'pause')
  })

  it('offers unpause for a paused container and start for a stopped one', async () => {
    const { wrapper } = await mountWithProject()
    const withState = (state: string) => ({
      ...tree,
      projects: [
        { ...tree.projects[0]!, services: [{ name: 'web', containers: [{ ...container, state }] }] }
      ]
    })
    treeListeners.at(-1)!(withState('paused'))
    await flushPromises()
    await wrapper.get('[data-test="service-row-shop-web"]').trigger('contextmenu')
    expect(menuItem(wrapper, 'Unpause Container').exists()).toBe(true)
    expect(menuItem(wrapper, 'Show Files').attributes('disabled')).toBeDefined()
    treeListeners.at(-1)!(withState('exited'))
    await flushPromises()
    await wrapper.get('[data-test="service-row-shop-web"]').trigger('contextmenu')
    expect(menuItem(wrapper, 'Start Container').exists()).toBe(true)
    expect(menuItem(wrapper, 'Attach').attributes('disabled')).toBeDefined()
  })

  it('types Attach without letting Ctrl+C reach the container', async () => {
    const { sent, wrapper } = await mountWithProject()
    await wrapper.get('[data-test="service-row-shop-web"]').trigger('contextmenu')
    await menuItem(wrapper, 'Attach').trigger('click')
    await flushPromises()
    expect(sent[0]!.command).toBe('docker attach --sig-proxy=false shop-web-1')
  })

  it('runs a compose action in its own terminal', async () => {
    const { host, sent, wrapper } = await mountWithProject()
    await wrapper.get('[data-test="project-row-shop"]').trigger('contextmenu')
    await menuItem(wrapper, 'Pull').trigger('click')
    await flushPromises()
    expect(sent).toEqual([
      { title: 'shop pull', command: 'docker compose -p shop -f /srv/shop/compose.yaml pull' }
    ])
    expect(host.containerAction).not.toHaveBeenCalled()
  })

  it('runs Exec with the typed command, and Create Terminal with the chosen shell', async () => {
    const { sent, wrapper } = await mountWithProject()
    await wrapper.get('[data-test="service-row-shop-web"]').trigger('contextmenu')
    await menuItem(wrapper, 'Exec').trigger('click')
    await wrapper.get('[data-test="dialog-input"]').setValue('env | sort')
    await wrapper.get('[data-test="dialog-confirm"]').trigger('click')
    await flushPromises()
    expect(sent[0]!.command).toBe('docker exec -it shop-web-1 env | sort')
    await wrapper.get('[data-test="service-row-shop-web"]').trigger('contextmenu')
    await menuItem(wrapper, 'Create Terminal').trigger('click')
    await menuItem(wrapper, 'bash').trigger('click')
    await flushPromises()
    expect(sent[1]!.command).toBe('docker exec -it shop-web-1 bash')
  })


  it('shows Inspect, Show Processes and Show Files inside the panel', async () => {
    const { host, wrapper } = await mountWithProject()
    const open = async (label: string) => {
      await wrapper.get('[data-test="service-row-shop-web"]').trigger('contextmenu')
      await menuItem(wrapper, label).trigger('click')
      await flushPromises()
      return wrapper.get('[data-test="details-text"]').text()
    }
    expect(await open('Inspect')).toContain('"Id": "abc"')
    expect(await open('Show Processes')).toBe('PID  CMD\n1    nginx')
    expect(await open('Show Files')).toBe('listing of /')
    await wrapper.get('[data-test="details-path"]').setValue('/etc')
    await wrapper.get('[data-test="details-path"]').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(host.files).toHaveBeenLastCalledWith('abc', '/etc')
    expect(wrapper.get('[data-test="details-text"]').text()).toBe('listing of /etc')
  })

  it('shows a failed details request in the viewer', async () => {
    const { host, wrapper } = await mountWithProject()
    host.processes = vi.fn(async () => {
      throw new Error('container is not running')
    })
    await wrapper.setProps({ host })
    await wrapper.get('[data-test="service-row-shop-web"]').trigger('contextmenu')
    await menuItem(wrapper, 'Show Processes').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-test="details-text"]').text()).toBe('container is not running')
  })

  it('closes the menu on Escape and on a click outside', async () => {
    const { wrapper } = await mountWithProject()
    const row = wrapper.get('[data-test="project-row-shop"]')
    await row.trigger('contextmenu')
    await wrapper.get('[data-test="context-menu"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[data-test="context-menu"]').exists()).toBe(false)
    await row.trigger('contextmenu')
    window.dispatchEvent(new Event('blur'))
    await flushPromises()
    expect(wrapper.find('[data-test="context-menu"]').exists()).toBe(false)
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

})

describe('createHostBridge', () => {
  function fakeOrca() {
    return {
      on: vi.fn(() => ({ dispose: () => undefined })),
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


  it('hears workspace changes from Orca', () => {
    const orca = fakeOrca()
    const listener = vi.fn()
    createHostBridge(orca).onContextChanged(listener)
    const [event, handler] = orca.on.mock.calls[0] as unknown as [string, (payload: unknown) => void]
    expect(event).toBe('workspace.changed')
    handler({ context: workspace })
    expect(listener).toHaveBeenCalledWith(workspace)
  })


  it('asks the worker to open a terminal, because panels cannot', async () => {
    const orca = fakeOrca()
    const input = { title: 'web sh', command: 'docker exec -it web sh' }
    await createHostBridge(orca).openTerminal(input)
    expect(orca.plugin.request).toHaveBeenCalledWith(OPEN_TERMINAL_REQUEST, input)
    expect(orca.host.call).not.toHaveBeenCalled()
  })

  it('passes a worker failure on to the caller', async () => {
    const orca = fakeOrca()
    orca.plugin.request.mockRejectedValue(Object.assign(new Error('worker is down'), { code: 'unavailable' }))
    await expect(createHostBridge(orca).openTerminal({ title: 't', command: 'c' })).rejects.toMatchObject({
      code: 'unavailable',
      message: 'worker is down'
    })
  })
})
