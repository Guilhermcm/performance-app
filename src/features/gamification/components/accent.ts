// Volt as text or a small glyph. On the light theme the brand green is only ~3.4:1 on white, so
// there it is pulled toward the foreground (about 5:1 on white and on its own 15% tint); the dark
// theme keeps the pure volt. A full class string, so Tailwind sees it.
export const ACCENT_TEXT = 'text-[color:color-mix(in_oklab,var(--primary)_70%,var(--foreground))] dark:text-primary'
