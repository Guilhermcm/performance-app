import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?'

// Decorative: the name is always written next to it. Google photos refuse some referrers.
export function PersonAvatar({ name, src, className }: { name: string; src: string | null; className?: string }) {
  return (
    <Avatar aria-hidden className={cn('size-11', className)}>
      {src && <AvatarImage src={src} alt="" referrerPolicy="no-referrer" />}
      <AvatarFallback className="bg-secondary font-medium text-foreground">{initials(name)}</AvatarFallback>
    </Avatar>
  )
}
