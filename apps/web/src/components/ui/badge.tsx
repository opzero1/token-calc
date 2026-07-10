import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-semibold',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-main text-main-foreground',
        neutral: 'bg-white/5 text-muted-foreground',
        accent: 'bg-accent text-accent-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}
