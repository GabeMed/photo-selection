# Components

Component catalog for **Cadê as Fotos?**. Import all components from the `src/web/design-system` folder, by relative path (`../design-system` from a page or a component of the app).

### Avatar

```ts
import { Avatar } from "../design-system"
```

**Props:**

| Prop | Type | Default |
|---|---|---|
| `size` | sm · md · lg | `md` |
| `pessoa` | any | `—` |

### BarraAcaoFixa

```ts
import { BarraAcaoFixa } from "../design-system"
```

### BarraProgressoEnvio

```ts
import { BarraProgressoEnvio } from "../design-system"
```

**Props:**

| Prop | Type | Default |
|---|---|---|
| `estado` | enviando · pronto · erro | `—` |
| `miniatura` | string | `—` |
| `nome` | string | `—` |
| `progresso` | number | `—` |
| `onTentarDeNovo` | function | `—` |

### BotaoPrincipal

```ts
import { BotaoPrincipal } from "../design-system"
```

Single primary action; loading is distinct from disabled.

**Props:**

| Prop | Type | Default |
|---|---|---|
| `variant` | destaque · tinta · suave | `destaque` |
| `size` | md · lg | `lg` |
| `progresso` | number | `—` |
| `carregando` | boolean | `—` |

**Examples:**

_Uso real_
```tsx
<BotaoPrincipal carregando progresso={62}>Enviando…</BotaoPrincipal>
```

**Avoid:**

- Never wrap the label or use disabled styling to indicate loading.

### CarimboViagem

```ts
import { CarimboViagem } from "../design-system"
```

Round trip souvenir displayed on the profile: one stamp per group the person is in.

**Props:**

| Prop | Type | Default |
|---|---|---|
| `nome` | string | `—` |
| `data` | string | `—` |
| `cor` | primaria · turquesa · laranja · amarelo · verde · azul · roxo | `primaria` |
| `size` | sm · md | `md` |

- `data` is the month and year the group was created, short and in pt-BR: "nov 2026" (`formatMonthYear` in `src/web/format.ts`).
- `cor` comes from `corCarimbo(group.id)`: the same trip always gets the same ink.
- A name longer than the top arc holds (16 letters) is cut with "…" (`nomeNoCarimbo`); the full name stays in the stamp's `aria-label`.

**Examples:**

_Uso real_
```tsx
<CarimboViagem nome={group.name} data={formatMonthYear(group.createdAt)} cor={corCarimbo(group.id)} />
```

**Avoid:**

- Do not omit the trip date.

### CartaoConvite

```ts
import { CartaoConvite } from "../design-system"
```

**Props:**

| Prop | Type | Default |
|---|---|---|
| `titulo` | string | `—` |
| `local` | string | `—` |
| `datas` | string | `—` |
| `capa` | string | `—` |
| `quemChamou` | Pessoa | `—` |
| `pessoas` | Pessoa[] | `—` |
| `totalPessoas` | number | `pessoas.length` |

In this site the invite shows the group's name, who invited (the group's creator, `invitedBy`) and the stack of the first members in join order (`members`, up to 8), with "+N" for everyone else (`totalPessoas` = `memberCount`). Their colors come from `groupPersonOf(members)`, the same as on the group page. All of it fits on a 390×844 screen without scrolling. No `capa`, `local` or `datas`: the site has no cover, place or dates for a group.

### CartaoFoto

```ts
import { CartaoFoto } from "../design-system"
```

Original-aspect-ratio grid photo with optional separate sticker controls.

**Props:**

| Prop | Type | Default |
|---|---|---|
| `src` | string | `—` |
| `largura` | number | `—` |
| `altura` | number | `—` |
| `autor` | any | `—` |
| `descricao` | string | `—` |
| `reacoes` | any | `—` |

**Examples:**

_Uso real_
```tsx
<CartaoFoto src={foto.src} largura={600} altura={800} autor={ana} reacoes={<Reacao adesivo="amor" />} />
```

**Avoid:**

- Do not crop photos or nest reaction buttons in the photo button.

### CartaoViagem

```ts
import { CartaoViagem } from "../design-system"
```

**Props:**

| Prop | Type | Default |
|---|---|---|
| `titulo` | string | `—` |
| `local` | string | `—` |
| `datas` | string | `—` |
| `capa` | string | `—` |
| `pessoas` | any | `—` |
| `totalFotos` | number | `—` |

### EstadoFotos

```ts
import { EstadoFotos } from "../design-system"
```

Compose empty, waiting, successful and failed photo states.

**Props:**

| Prop | Type | Default |
|---|---|---|
| `titulo` | string | `—` |

**Examples:**

_Uso real_
```tsx
<EstadoFotos variant="pronto" titulo="Achei!">As fotos chegaram.</EstadoFotos>
```

**Avoid:**

- Do not use a celebrating mascot for errors.

### FotoTelaCheia

```ts
import { FotoTelaCheia } from "../design-system"
```

**Props:**

| Prop | Type | Default |
|---|---|---|
| `fotos` | any | `—` |
| `indiceInicial` | number | `—` |
| `onFechar` | function | `—` |

### Logo

```ts
import { Logo } from "../design-system"
```

Brand wordmark, only Cadê?.

**Props:**

| Prop | Type | Default |
|---|---|---|
| `size` | sm · md · lg | `md` |

**Examples:**

_Uso real_
```tsx
<Logo size="md" />
```

**Avoid:**

- Do not replace with the full product name or an imitation of another brand.

### Mascote

```ts
import { Mascote } from "../design-system"
```

Original question-mark mascot for invitation and status messages.

**Props:**

| Prop | Type | Default |
|---|---|---|
| `size` | sm · md · lg | `md` |
| `variant` | esquerda · direita · suave | `suave` |
| `pose` | any | `curioso` |

**Examples:**

_Uso real_
```tsx
<Mascote pose="curioso" />
```

**Avoid:**

- Never render inside FotoTelaCheia.

### PilhaAvatares

```ts
import { PilhaAvatares } from "../design-system"
```

**Props:**

| Prop | Type | Default |
|---|---|---|
| `pessoas` | Pessoa[] | `—` |
| `max` | number | `4` |
| `total` | number | `pessoas.length` |
| `size` | sm · md | `sm` |

`total` is for a list that holds only some of the people: "+N" counts everyone not shown.

### Reacao

```ts
import { Reacao } from "../design-system"
```

Toggle one of eight original stickers on a grid photo.

**Props:**

| Prop | Type | Default |
|---|---|---|
| `size` | sm · md | `md` |
| `variant` | esquerda · direita · suave | `esquerda` |
| `adesivo` | any | `—` |
| `rotulo` | string | `—` |
| `ativo` | boolean | `false` |
| `onAlternar` | function | `—` |

**Examples:**

_Uso real_
```tsx
<Reacao adesivo="amor" ativo={ativo} onAlternar={setAtivo} />
```

**Avoid:**

- Never use emoji, counters, nested photo buttons or fullscreen reactions.

### TelaCelular

```ts
import { TelaCelular } from "../design-system"
```

Keeps room at the bottom for a `BarraAcaoFixa`. A bar whose height changes (the selection bar) reserves exactly its own height with a spacer marked `data-reserva-barra`; while that spacer is on the page, `TelaCelular` drops its own bottom room, so the content ends right above the bar.

