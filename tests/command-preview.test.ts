// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import CommandPreview from '../src/panel/components/CommandPreview.vue'

describe('CommandPreview', () => {
  it('keeps every argument whole, so a line never breaks inside a flag', () => {
    const wrapper = mount(CommandPreview, { props: { command: 'docker compose up -d --remove-orphans api' } })
    expect(wrapper.findAll('.word').map((word) => word.text())).toEqual([
      'docker',
      'compose',
      'up',
      '-d',
      '--remove-orphans',
      'api'
    ])
    expect(wrapper.text()).toBe('docker compose up -d --remove-orphans api')
  })
})
