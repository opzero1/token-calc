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
        content: 'token-calc visualizes local AI coding tool token usage and estimated costs.',
      },
      { title: 'token-calc' },
    ],
    links: [
      {
        rel: 'icon',
        href: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='16' fill='%237cf3b5'/><circle cx='25' cy='25' r='9' fill='none' stroke='%2307100c' stroke-width='5'/><path d='M25 19v7l5 3M39 30v11a7 7 0 0 1-14 0v-4m9 4h10' fill='none' stroke='%2307100c' stroke-width='5' stroke-linecap='round'/></svg>",
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
