import type { ReactNode } from 'react'

// Stand-in for components/ui/drawer in tests: vaul measures layout and pointer movement, which
// happy-dom does not have. An open drawer renders in place as a dialog.
type P = { children?: ReactNode; className?: string }
export function Drawer({ open, children }: { open?: boolean; onOpenChange?: (open: boolean) => void; children?: ReactNode }) {
  return open ? <div role="dialog">{children}</div> : null
}
export const DrawerContent = ({ children }: P) => <>{children}</>
export const DrawerHeader = ({ children }: P) => <div>{children}</div>
export const DrawerFooter = ({ children }: P) => <div>{children}</div>
export const DrawerTitle = ({ children }: P) => <h2>{children}</h2>
export const DrawerDescription = ({ children }: P) => <p>{children}</p>
