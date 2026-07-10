import * as React from 'react'

import { cn } from '@/lib/utils'

export function TabsList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'inline-flex max-w-full overflow-x-auto rounded-xl border border-border bg-black/20 p-1',
        className,
      )}
      {...props}
    />
  )
}

export function TabsTrigger({
  className,
  active,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      className={cn(
        'rounded-lg px-3 py-1.5 font-heading text-xs font-bold text-muted-foreground transition-colors hover:text-foreground sm:text-sm',
        active ? 'bg-main text-main-foreground' : 'hover:bg-white/5',
        className,
      )}
      type="button"
      {...props}
    />
  )
}
