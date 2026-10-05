import { useEffect, useState, type CSSProperties } from "react"
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

// The app's theme is the one App.jsx writes on <html data-theme> (Settings → Appearance, 'system'
// already resolved there), not the OS preference or next-themes: followed live, so toasts switch
// with the rest of the app.
const readTheme = (): "light" | "dark" =>
  typeof document !== "undefined" && document.documentElement.dataset.theme === "light" ? "light" : "dark"

export function useAppTheme() {
  const [theme, setTheme] = useState(readTheme)
  useEffect(() => {
    const root = document.documentElement
    const obs = new MutationObserver(() => setTheme(readTheme()))
    obs.observe(root, { attributes: true, attributeFilter: ["data-theme"] })
    setTheme(readTheme())
    return () => obs.disconnect()
  }, [])
  return theme
}

// Top of the screen, under the status bar and the sync indicator (--sat and --conn, index.css):
// the legacy toast (components/Toast.jsx) sits at the bottom, above the tab bar, so the two never
// meet.
const TOP = "calc(var(--sat, 0px) + var(--conn, 0px) + 12px)"

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useAppTheme()

  return (
    <Sonner
      theme={theme}
      position="top-center"
      offset={{ top: TOP }}
      mobileOffset={{ top: TOP, left: "16px", right: "16px" }}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
