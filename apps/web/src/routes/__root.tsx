/// <reference types="vite/client" />

import type { ReactNode } from 'react'
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'

import '../styles.css'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      {
        name: 'description',
        content: 'A private, local observatory for AI coding token usage and estimated model spend.',
      },
      { title: 'token / lens' },
    ],
    links: [
      {
        rel: 'icon',
        href: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='32' fill='%23d9ff63'/><path d='M18 23h28M18 32h18M18 41h28' fill='none' stroke='%23111500' stroke-width='5' stroke-linecap='round'/></svg>",
      },
    ],
  }),
  component: RootComponent,
})

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
