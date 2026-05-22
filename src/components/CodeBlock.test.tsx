/* CodeBlock.test.tsx — fenced code block: highlight + copy. */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const copyMock = vi.fn()
vi.mock('./Common', async () => {
  const actual = await vi.importActual<typeof import('./Common')>('./Common')
  return { ...actual, copyToClipboard: (...a: any[]) => copyMock(...a) }
})

import { CodeBlock } from './CodeBlock'

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => cleanup())

describe('CodeBlock', () => {
  it('renders monochrome with no language', () => {
    render(<CodeBlock code="just text" lang={null} />)
    expect(screen.getByText('just text')).toBeTruthy()
    expect(document.querySelector('pre')!.getAttribute('data-lang')).toBe('')
    expect(document.querySelector('.code-block-lang')).toBeNull()
  })

  it('renders an unknown language as monochrome', () => {
    render(<CodeBlock code="x = 1" lang="rust" />)
    expect(screen.getByText('x = 1')).toBeTruthy()
    expect(document.querySelector('pre')!.getAttribute('data-lang')).toBe('')
  })

  it('highlights bash with the lang label', () => {
    render(<CodeBlock code={'# comment\ncurl -X POST "url" 42'} lang="sh" />)
    expect(document.querySelector('.code-block-lang')!.textContent).toBe('bash')
    expect(document.querySelector('.tok-comment')).toBeTruthy()
    expect(document.querySelector('.tok-keyword')).toBeTruthy()
    expect(document.querySelector('.tok-flag')).toBeTruthy()
    expect(document.querySelector('.tok-number')).toBeTruthy()
    expect(document.querySelector('.tok-string')).toBeTruthy()
  })

  it('highlights json keys, strings, numbers, bools', () => {
    render(<CodeBlock code={'{"k": "v", "n": 3, "b": true, "z": null}'} lang="jsonc" />)
    expect(document.querySelector('.tok-key')).toBeTruthy()
    expect(document.querySelector('.tok-string')).toBeTruthy()
    expect(document.querySelector('.tok-number')).toBeTruthy()
    expect(document.querySelector('.tok-bool')).toBeTruthy()
  })

  it('highlights yaml keys, comments, numbers, bools, strings', () => {
    render(<CodeBlock code={'# c\nkey: "val"\nnum: 5\nflag: yes'} lang="yml" />)
    expect(document.querySelector('.code-block-lang')!.textContent).toBe('yaml')
    expect(document.querySelector('.tok-comment')).toBeTruthy()
    expect(document.querySelector('.tok-key')).toBeTruthy()
    expect(document.querySelector('.tok-number')).toBeTruthy()
    expect(document.querySelector('.tok-bool')).toBeTruthy()
    expect(document.querySelector('.tok-string')).toBeTruthy()
  })

  it('copies code and flashes "Copied!"', async () => {
    copyMock.mockResolvedValue(true)
    render(<CodeBlock code="echo hi" lang="bash" />)
    const btn = screen.getByRole('button', { name: 'Copy code to clipboard' })
    await userEvent.click(btn)
    expect(copyMock).toHaveBeenCalledWith('echo hi')
    await waitFor(() => expect(screen.getByText('Copied!')).toBeTruthy())
  })

  it('does not flash when the copy fails', async () => {
    copyMock.mockResolvedValue(false)
    render(<CodeBlock code="echo hi" lang="bash" />)
    await userEvent.click(screen.getByRole('button', { name: 'Copy code to clipboard' }))
    expect(screen.queryByText('Copied!')).toBeNull()
  })
})
