import { useRef } from 'react'

// A button that opens a file picker and hands the chosen File to onImport.
export default function ImportButton({ onImport, className = 'ghost full gap', label = 'Import Project JSON' }) {
  const ref = useRef(null)

  function handleChange(e) {
    const file = e.target.files && e.target.files[0]
    if (file) onImport(file)
    e.target.value = '' // allow re-importing the same file
  }

  return (
    <>
      <button className={className} onClick={() => ref.current && ref.current.click()}>
        {label}
      </button>
      <input
        ref={ref}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={handleChange}
      />
    </>
  )
}
