import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MarkdownView } from './MarkdownView'

describe('MarkdownView', () => {
  it('does not render raw HTML, remote images, or unsafe links', () => {
    const { container } = render(
      <MarkdownView text={'<script>window.hacked = true</script>\n\n![remote](https://example.com/x.png)\n\n[bad](javascript:alert(1))\n\n**safe**'} />,
    )
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('a')).toBeNull()
    expect(screen.getByText('safe')).toHaveProperty('tagName', 'STRONG')
    expect((window as Window & { hacked?: boolean }).hacked).toBeUndefined()
  })
})
