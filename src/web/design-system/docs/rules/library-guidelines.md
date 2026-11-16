# Cadê as Fotos? — Guidelines

## Components

The design system exports these components — import them from `src/web/design-system` and compose them before building anything from scratch:

`Avatar`, `BarraAcaoFixa`, `BarraProgressoEnvio`, `BotaoPrincipal`, `CarimboViagem`, `CartaoConvite`, `CartaoFoto`, `CartaoViagem`, `EstadoFotos`, `FotoTelaCheia`, `Logo`, `Mascote`, `PilhaAvatares`, `Reacao`, `TelaCelular`

Per-component details (import stanzas, props, variants, examples) live in `components.md`, next to this file — on disk, not auto-loaded. Read that file or the component source when the name alone isn't enough.

## Theme Files

The design system's theme is delivered through the following files. The author's original source files carry the full wiring the design system needs — variable declarations, framework-specific directives, provider objects, etc. — and are the canonical import target.

- `src/web/design-system/styles.css` (source — preferred import)

