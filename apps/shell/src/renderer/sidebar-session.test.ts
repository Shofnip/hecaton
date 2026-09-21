import { describe, expect, it } from 'vitest'
import { SidebarSession } from './sidebar-session.js'

const ACTIONS = ['power-all', 'add-screen', 'open-profiles'] as const

describe('SidebarSession', () => {
  it('starts expanded in shipped order and restores session state after focus', () => {
    const sidebar = new SidebarSession(ACTIONS)
    expect(sidebar.view(false)).toEqual({ hidden: false, collapsed: false, order: ACTIONS })

    sidebar.toggleCollapsed()
    sidebar.move('open-profiles', 'power-all')
    expect(sidebar.view(true)).toMatchObject({ hidden: true })
    expect(sidebar.view(false)).toEqual({
      hidden: false,
      collapsed: true,
      order: ['open-profiles', 'power-all', 'add-screen'],
    })
  })

  it('cancels a drag on pointer cancellation or window blur', () => {
    const sidebar = new SidebarSession(ACTIONS)
    sidebar.beginDrag('power-all', 7, 10, 10)
    sidebar.movePointer(7, 25, 10, 1, 'add-screen')
    expect(sidebar.dragging).toBe(true)

    sidebar.cancelDrag()
    expect(sidebar.dragging).toBe(false)
    expect(sidebar.view(false).order).toEqual(ACTIONS)
  })

  it('reorders through the complete pointer gesture', () => {
    const sidebar = new SidebarSession(ACTIONS)
    sidebar.beginDrag('open-profiles', 9, 10, 10)
    expect(sidebar.tracking).toBe(true)
    expect(sidebar.movePointer(9, 20, 10, 1, 'power-all')).toBe('moved')

    expect(sidebar.endDrag(9)).toEqual({ dragged: true, reordered: true })
    expect(sidebar.tracking).toBe(false)
    expect(sidebar.view(false).order).toEqual(['open-profiles', 'power-all', 'add-screen'])
  })
})
