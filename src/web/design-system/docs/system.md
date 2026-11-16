# Cadê as Fotos? design system

Mobile-first photo-sharing site for friend groups on a trip. Tone: playful, cartoonish, light — never corporate. Inspired by "not taking itself seriously" party-invite sites: chunky rounded display type, thick ink outlines, hard offset shadows, warm paper background.

## Copy
- Portuguese (Brazil), informal, short. Right: "Bora subir as fotos?", "Só faltam as do Pedro 👀". Wrong: "Realize o upload dos seus arquivos".

## Hard rules
- Mobile, one-handed. Base width 390px; on desktop center content in a column max 480px (`max-w-coluna mx-auto`, or wrap screens in `TelaCelular`).
- The main action is always a large `BotaoPrincipal` with wrapped in `BarraAcaoFixa` at the bottom.
- Every color, font, radius and shadow comes from tokens in `src/web/design-system/styles.css` (`bg-primary`, `shadow-pop`, `rounded-xl`, `font-display`). Never a raw hex/px value in a component.
- One accent color (`primary`) per screen.
- The photo is the star: surrounding UI stays discreet. Photos are never cropped in grids — respect the original aspect ratio.
- Fullscreen photo (`FotoTelaCheia`): black `bg-palco`, no frame, no filter, no decoration; horizontal swipe to next.
- Each person has their own color (`CorPessoa`: turquesa, laranja, amarelo, verde, azul, roxo) used on the avatar ring and their photo tag. One place decides it, `src/web/people.ts`:
  - Inside a group (group page, invite), colors follow the order in which members joined (`groupPersonOf(members)`, with `members` in join order as the API lists them): the first six people never share a color; from the seventh on, the colors start over. Every place on that page (avatars, filters, photo tags, viewer) uses the same function, so a person has one color there.
  - Outside a group (the header, the profile), the color comes from the person's id (`toPessoa`).
- Text reaches at least 4.5:1 against its background; see the contrast note in `design-tokens.md`. The theme is always light.
- No like counts, no public feed. Everything is private to the group. `Reacao` is a toggle, never a counter.
- Reuse existing components before creating new ones.

## Accessibility
- Semantic elements (`button`, `a`, `label`), visible focus ring (`focus-visible:ring-ring`), alt text on photos, `aria-label` on icon-only buttons. Touch targets at least 44px.

See `design-tokens.md` and `components.md` for specifics.

## Brand and stickers
- Product name: “Cadê as Fotos?”; the logo and nickname are only “Cadê?”. Preserve the palette.
- Use `Logo` for the wordmark, not a substitute. Its question mark is larger and its lower corner is lifted.
- The original SVG assets ship under `src/web/design-system/assets/illustrations` and `src/web/design-system/assets/icons`; render them through `Mascote` and `Reacao` so semantic palette tokens resolve in both themes.
- `sticker` provides the white inner outline, outer ink outline, pop shadow and bounce. Rotation variants remain between -4° and 4°. Respect reduced motion. SVG viewBox geometry and logo relative question-mark scale are deliberately geometric, not layout tokens.
- `Mascote` poses: curioso, comemorando, esperando, triste. Use `EstadoFotos` for empty, success, waiting and error states. Empty asks “Cadê?”, success answers “Achei!”, errors use triste. Invitations include curioso.
- `Reacao` takes `adesivo`, not emoji: fogo, amor, risada, uau, olhos, camera, brilho, joinha. It is a toggle, without counters. Put reactions in `CartaoFoto.reacoes`; do not nest buttons in a photo button.
- `CarimboViagem` is a round profile souvenir with `nome` and `data`: one per group, with the month and year the group was created ("nov 2026") and an ink from `corCarimbo(group.id)`.
- `CartaoConvite` shows the group's name, who invited and the stack of members, all visible without scrolling. No cover.
- NEVER render stickers, mascot or reactions inside `FotoTelaCheia`. Keep its photo-only data separate.
- `BotaoPrincipal` loading uses a spinner with optional numeric `progresso`; disabled is high-contrast muted, never loading. Text never wraps.

```tsx
<Logo size="md" />
<EstadoFotos variant="pronto" titulo="Achei!">As fotos chegaram.</EstadoFotos>
<BotaoPrincipal carregando progresso={62}>Enviando…</BotaoPrincipal>
<Reacao adesivo="amor" ativo={ativo} onAlternar={setAtivo} />
```

## Sticker layer (current)
- Mascote is a die-cut sticker: the white + ink cut line is drawn in the artwork and follows the "?" silhouette (`sticker-recorte`); never wrap it in a circle or box. Sizes xs (24px) to lg.
- CartaoFoto: interactive reactions go in `reacoes` (strip below the photo); only given ones go in `reacoesDadas` (small, bottom corner of the photo).
- CarimboViagem: passport ink stamp, one `cor` per trip, tilt derived from the trip name.
