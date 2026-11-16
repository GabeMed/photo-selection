# Components

Component catalog for **Cadê as Fotos?**. Import all components from `src/web/design-system`.

### Avatar

```ts
import { Avatar } from "src/web/design-system"
```

**Props:**

| Prop | Type | Default |
|---|---|---|
| `size` | sm · md · lg | `md` |
| `pessoa` | any | `—` |

### BarraAcaoFixa

```ts
import { BarraAcaoFixa } from "src/web/design-system"
```

### BarraProgressoEnvio

```ts
import { BarraProgressoEnvio } from "src/web/design-system"
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
import { BotaoPrincipal } from "src/web/design-system"
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
import { CarimboViagem } from "src/web/design-system"
```

Round trip souvenir displayed on the profile.

**Props:**

| Prop | Type | Default |
|---|---|---|
| `nome` | string | `—` |
| `data` | string | `—` |

**Examples:**

_Uso real_
```tsx
<CarimboViagem nome="Chapada 2026" data="12–18 out" />
```

**Avoid:**

- Do not omit the trip date.

### CartaoConvite

```ts
import { CartaoConvite } from "src/web/design-system"
```

**Props:**

| Prop | Type | Default |
|---|---|---|
| `titulo` | string | `—` |
| `local` | string | `—` |
| `datas` | string | `—` |
| `capa` | string | `—` |
| `quemChamou` | any | `—` |
| `pessoas` | any | `—` |

### CartaoFoto

```ts
import { CartaoFoto } from "src/web/design-system"
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
import { CartaoViagem } from "src/web/design-system"
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
import { EstadoFotos } from "src/web/design-system"
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
import { FotoTelaCheia } from "src/web/design-system"
```

**Props:**

| Prop | Type | Default |
|---|---|---|
| `fotos` | any | `—` |
| `indiceInicial` | number | `—` |
| `onFechar` | function | `—` |

### Logo

```ts
import { Logo } from "src/web/design-system"
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
import { Mascote } from "src/web/design-system"
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
import { PilhaAvatares } from "src/web/design-system"
```

**Props:**

| Prop | Type | Default |
|---|---|---|
| `pessoas` | any | `—` |
| `max` | number | `4` |
| `size` | sm · md | `sm` |

### Reacao

```ts
import { Reacao } from "src/web/design-system"
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
import { TelaCelular } from "src/web/design-system"
```

