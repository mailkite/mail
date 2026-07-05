import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App, ThemeProvider, DecryptionKeysProvider } from '@mailkite/ui'
import './client.css'

const el = document.getElementById('root')
if (!el) throw new Error('#root not found')

createRoot(el).render(
  <StrictMode>
    <ThemeProvider>
      <DecryptionKeysProvider>
        <App />
      </DecryptionKeysProvider>
    </ThemeProvider>
  </StrictMode>,
)
