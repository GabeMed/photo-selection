# Design Tokens

Token reference for **Cadê as Fotos?**. Use utility classes and CSS variables — never raw values.

## Colors

Apply with any color utility: `bg-<name>`, `text-<name>`, `border-<name>`, `ring-<name>`, `divide-<name>`, etc.

**Contrast.** Text needs at least 4.5:1 against its background (WCAG AA). `primary` (`oklch(0.59 0.25 355)`) and `destructive` (`oklch(0.59 0.22 28)`) sit just below the lightest value that still gives white text 4.5:1 (that limit is about 0.598 and 0.595), so the result does not depend on rounding. They used to be `oklch(0.66 0.25 355)` (3.55:1) and `oklch(0.6 0.22 28)` (4.40:1); only the lightness changed. Darkening them more is fine; lightening them breaks the white text. The person colors are light on purpose: they carry dark `tinta` text, never white.

| Name | CSS variable |
|---|---|
| `tinta` | `--tinta` |
| `papel` | `--papel` |
| `card` | `--card` |
| `popover` | `--popover` |
| `primary` | `--primary` |
| `primary-foreground` | `--primary-foreground` |
| `secondary` | `--secondary` |
| `muted` | `--muted` |
| `muted-foreground` | `--muted-foreground` |
| `accent` | `--accent` |
| `destructive` | `--destructive` |
| `destructive-foreground` | `--destructive-foreground` |
| `sucesso` | `--sucesso` |
| `ring` | `--ring` |
| `palco` | `--palco` |
| `palco-foreground` | `--palco-foreground` |
| `pessoa-turquesa` | `--pessoa-turquesa` |
| `pessoa-laranja` | `--pessoa-laranja` |
| `pessoa-amarelo` | `--pessoa-amarelo` |
| `pessoa-verde` | `--pessoa-verde` |
| `pessoa-azul` | `--pessoa-azul` |
| `pessoa-roxo` | `--pessoa-roxo` |

## Typography

Typography classes (`font-*` for families, `text-*` for sizes):

| Class | CSS variable |
|---|---|
| `font-display` | `--font-display` |
| `font-body` | `--font-body` |
| `font-sans` | `--font-sans` |
| `text-logo-sm` | `--text-logo-sm` |
| `text-logo-md` | `--text-logo-md` |
| `text-logo-lg` | `--text-logo-lg` |

## Border Radius

Border-radius classes:

| Class | CSS variable |
|---|---|
| `rounded-sm` | `--radius-sm` |
| `rounded-md` | `--radius-md` |
| `rounded-xl` | `--radius-xl` |
| `rounded-2xl` | `--radius-2xl` |
| `rounded-pill` | `--radius-pill` |
| `rounded` | `--radius` |

## Shadows

Box-shadow classes:

| Class | CSS variable |
|---|---|
| `shadow-pop` | `--shadow-pop` |
| `shadow-pop-sm` | `--shadow-pop-sm` |
| `shadow-pop-lg` | `--shadow-pop-lg` |
| `shadow-flutuante` | `--shadow-flutuante` |
| `shadow-sticker` | `--shadow-sticker` |

## Other

Reference via `var(--name)` in inline styles or CSS.

| CSS variable |
|---|
| `--container-coluna` |
| `--rotate-sticker-esquerda` |
| `--rotate-sticker-direita` |
| `--rotate-sticker-suave` |
| `--sticker-inner` |
| `--sticker-outline` |
| `--sticker-ink-width` |
| `--sticker-stroke` |
| `--sticker-duration` |
| `--sticker-lift` |
| `--sticker-fold` |


**Stamp ink.** `CarimboViagem` deepens its trip color with `tinta` (`.tinta-carimbo`, mixed in oklab so the hue stays) so light inks stay readable on `papel`.
