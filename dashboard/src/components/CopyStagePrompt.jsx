import { useState } from 'react'
import { buildStagePrompt } from '../lib/stagePrompt.js'

// Builds a copy-paste LLM prompt for the given stage and copies it to clipboard.
export default function CopyStagePrompt({ project, stageKey }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    const prompt = buildStagePrompt(project, stageKey)
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard may be blocked; ignore.
    }
  }

  return (
    <button className="ghost small" onClick={copy} title="Copy a prompt to paste into ChatGPT / Claude / Gemini">
      {copied ? 'Copied prompt ✓' : 'Copy Stage Prompt'}
    </button>
  )
}
