import * as React from 'react'

import { cn } from '@/lib/utils'

export function TabsList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'inline-flex max-w-full overflow-x-auto rounded-full border border-border bg-black/25 p-1',
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
        'h-9 min-w-11 rounded-full px-3 font-heading text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground sm:text-xs',
        active ? 'bg-main text-main-foreground' : 'hover:bg-white/5',
        className,
      )}
      type="button"
      {...props}
    />
  )
}
