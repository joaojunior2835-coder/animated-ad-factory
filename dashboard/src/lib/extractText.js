// Text extraction from uploaded files. TXT/MD/JSON are read directly. PDF and
// DOCX use lazily-imported libraries; any failure falls back to "paste manually"
// so the app never breaks.

function extByName(name) {
  return (String(name || '').split('.').pop() || '').toLowerCase()
}

export function sourceTypeForExt(ext) {
  if (ext === 'txt' || ext === 'text') return 'txt'
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (ext === 'json') return 'json'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  return ext || 'unknown'
}

async function extractPdf(file) {
  try {
    const pdfjs = await import('pdfjs-dist')
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

    const data = await file.arrayBuffer()
    const pdf = await pdfjs.getDocument({ data }).promise
    let text = ''
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      text += content.items.map((it) => (it.str != null ? it.str : '')).join(' ') + '\n\n'
    }
    const clean = text.replace(/[ \t]+\n/g, '\n').trim()
    if (!clean) {
      return { text: '', source_type: 'pdf', status: 'failed', message: 'No selectable text found (scanned PDF?). Paste the text manually.' }
    }
    // pdfjs surfaces no structured warnings, so any extracted text is treated as a
    // success. "partial" requires warnings, which only the DOCX path produces.
    return {
      text: clean,
      source_type: 'pdf',
      status: 'success',
      message: 'text extracted, formatting ignored. Complex formatting, images, and tables may not convert.'
    }
  } catch {
    return { text: '', source_type: 'pdf', status: 'failed', message: 'PDF auto-extraction failed. Paste the extracted text manually.' }
  }
}

async function extractDocx(file) {
  try {
    const mammoth = await import('mammoth/mammoth.browser')
    const arrayBuffer = await file.arrayBuffer()
    const result = await mammoth.extractRawText({ arrayBuffer })
    const clean = String((result && result.value) || '').trim()
    if (!clean) {
      return { text: '', source_type: 'docx', status: 'failed', message: 'No text found in the document. Paste the text manually.' }
    }
    const hasWarnings = !!(result.messages && result.messages.length > 0)
    const short = clean.length <= 500
    // "partial" only when extraction warned AND the result is short / likely incomplete.
    if (hasWarnings && short) {
      return {
        text: clean,
        source_type: 'docx',
        status: 'partial',
        message: 'Short or possibly incomplete extraction. Complex formatting, images, and tables may not convert.'
      }
    }
    return {
      text: clean,
      source_type: 'docx',
      status: 'success',
      message: 'text extracted, formatting ignored. Complex formatting, images, and tables may not convert.'
    }
  } catch {
    return { text: '', source_type: 'docx', status: 'failed', message: 'DOCX auto-extraction failed. Paste the extracted text manually.' }
  }
}

export async function extractFromFile(file) {
  const ext = extByName(file.name)
  const source_type = sourceTypeForExt(ext)

  if (source_type === 'txt' || source_type === 'markdown') {
    const text = await file.text()
    return { text, source_type, status: 'success', message: '' }
  }
  if (source_type === 'json') {
    const text = await file.text()
    let status = 'success'
    let message = ''
    try {
      JSON.parse(text)
    } catch {
      status = 'partial'
      message = 'File is not valid JSON, but the text was kept.'
    }
    return { text, source_type, status, message }
  }
  if (source_type === 'pdf') return extractPdf(file)
  if (source_type === 'docx') return extractDocx(file)

  return { text: '', source_type, status: 'failed', message: 'Unsupported file type. Supported: .txt, .md, .json, .pdf, .docx.' }
}
