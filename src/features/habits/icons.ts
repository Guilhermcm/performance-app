import {
  Apple, Bed, Bike, Book, Brain, Check, Code, Coffee, Dog, Droplet, Dumbbell, Footprints, Heart,
  Languages, Leaf, Moon, Music, Pen, Pill, PhoneOff, PiggyBank, Salad, Smile, Sun,
  type LucideIcon,
} from 'lucide-react'

// The fixed list of icon keys a habit can use (plan decision 16). The server accepts the same keys.
// 'check' comes first and is the default.
const ICONS: Record<string, LucideIcon> = {
  check: Check,
  book: Book,
  dumbbell: Dumbbell,
  footprints: Footprints,
  bike: Bike,
  droplet: Droplet,
  pill: Pill,
  apple: Apple,
  salad: Salad,
  coffee: Coffee,
  bed: Bed,
  sun: Sun,
  moon: Moon,
  brain: Brain,
  heart: Heart,
  smile: Smile,
  music: Music,
  pen: Pen,
  languages: Languages,
  code: Code,
  'piggy-bank': PiggyBank,
  leaf: Leaf,
  dog: Dog,
  'phone-off': PhoneOff,
}

export const HABIT_ICONS: readonly string[] = Object.keys(ICONS)

// A key from another app version shows the default icon.
export function iconFor(key: string): LucideIcon {
  return Object.hasOwn(ICONS, key) ? ICONS[key] : Check
}
