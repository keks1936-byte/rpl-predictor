import './globals.css'
import './awards.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'РПЛ Predictor',
  description: 'Мини-лига прогнозов на матчи РПЛ'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  )
}
