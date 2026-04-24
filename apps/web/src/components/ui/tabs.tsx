import * as React from 'react'

import { cn } from '@/lib/utils'

export function TabsList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('inline-flex border-2 border-border bg-secondary-background shadow-shadow', className)} {...props} />
}

export function TabsTrigger({
  className,
  active,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      className={cn(
        'border-r-2 border-border px-3 py-2 text-sm font-black last:border-r-0 hover:bg-accent',
        active ? 'bg-main text-main-foreground' : 'bg-secondary-background text-foreground',
        className,
      )}
      type="button"
      {...props}
    />
  )
}
