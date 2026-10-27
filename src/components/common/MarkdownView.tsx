import { Check, Copy } from 'lucide-react'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import python from 'highlight.js/lib/languages/python'
import typescript from 'highlight.js/lib/languages/typescript'
import { isValidElement, memo, useEffect, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { isSafeLink, languageFromClassName } from '../../logic/markdown'
import { copyToClipboard } from '../../utils/clipboard'

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('python', python)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('ts', typescript)

const safeSchema = {
  ...defaultSchema,
  tagNames: (defaultSchema.tagNames ?? []).filter((tag) => tag !== 'img'),
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a ?? []), 'target', 'rel'],
  },
}

function textContent(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(textContent).join('')
  if (isValidElement<{ children?: ReactNode }>(children)) {
    return textContent(children.props.children)
  }
  return ''
}

function CodeBlock({ children, className }: { children: ReactNode; className?: string }) {
  const codeRef = useRef<HTMLElement>(null)
  const [copied, setCopied] = useState(false)
  const code = textContent(children).replace(/\n$/, '')
  const language = languageFromClassName(className)

  useEffect(() => {
    const element = codeRef.current
    if (!element) return
    if (language && hljs.getLanguage(language)) hljs.highlightElement(element)
  }, [code, language])

  return (
    <div className="code-block">
      <button
        type="button"
        className="code-copy-button"
        aria-label="Copy code"
        onClick={() => {
          void copyToClipboard(code).then((success) => {
            if (!success) return
            setCopied(true)
            globalThis.setTimeout(() => setCopied(false), 1_200)
          })
        }}
      >
        {copied ? <Check size={10} /> : <Copy size={10} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre>
        <code ref={codeRef} className={className}>
          {code}
        </code>
      </pre>
    </div>
  )
}

export const MarkdownView = memo(function MarkdownView({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, safeSchema]]}
        components={{
          a: ({ href, children, ...props }) =>
            isSafeLink(href) ? (
              <a {...props} href={href} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          pre: ({ children }) => {
            const child = Array.isArray(children) ? children[0] : children
            if (isValidElement<{ className?: string; children?: ReactNode }>(child)) {
              return <CodeBlock className={child.props.className}>{child.props.children}</CodeBlock>
            }
            return <pre>{children}</pre>
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
