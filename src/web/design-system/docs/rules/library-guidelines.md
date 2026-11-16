# Cadê as Fotos? — Guidelines

## Components

The design system exports these components — import them from `src/web/design-system` and compose them before building anything from scratch:

`Avatar`, `BarraAcaoFixa`, `BarraProgressoEnvio`, `BotaoPrincipal`, `CarimboViagem`, `CartaoConvite`, `CartaoFoto`, `CartaoViagem`, `EstadoFotos`, `FotoTelaCheia`, `Logo`, `Mascote`, `PilhaAvatares`, `Reacao`, `TelaCelular`

Per-component details (import stanzas, props, variants, examples) live in `components.md`, next to this file. Read that file or the component source when the name alone isn't enough.

## Theme

`src/web/design-system/styles.css` holds every token (colors, fonts, radii, shadows) and the Tailwind setup. It is the only source of them; change a token there, never in a component.

