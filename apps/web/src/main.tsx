import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MailApp, ThemeProvider } from '@mailkite/ui'
import './client.css'

const el = document.getElementById('root')
if (!el) throw new Error('#root not found')

createRoot(el).render(
  <StrictMode>
    <ThemeProvider>
      <MailApp />
    </ThemeProvider>
  </StrictMode>,
)
