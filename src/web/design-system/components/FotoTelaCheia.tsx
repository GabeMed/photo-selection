import * as React from "react";
import { X } from "lucide-react";
import { cn } from "../lib/utils";

export interface FotoTelaCheiaItem {
  id: string;
  /** Missing while the photo has no screen version; `descricao` is shown in its place. */
  src?: string;
  descricao?: string;
}

export interface FotoTelaCheiaProps extends React.HTMLAttributes<HTMLDialogElement> {
  fotos: FotoTelaCheiaItem[];
  indiceInicial: number;
  onFechar: () => void;
  /** Called with the index of the photo on screen once a swipe settles. */
  onMudar?: (indice: number) => void;
}

/** Opens the dialog as a modal (focus trapped, Escape, focus restored on close) and keeps the page behind it still. */
function useDialogoModal(dialogo: React.RefObject<HTMLDialogElement | null>) {
  React.useLayoutEffect(() => {
    const el = dialogo.current!;
    const raiz = document.documentElement;
    const overflowAntes = raiz.style.overflow;
    el.showModal();
    raiz.style.overflow = "hidden";
    return () => {
      el.close();
      raiz.style.overflow = overflowAntes;
    };
  }, []);
}

/** Fullscreen photo viewer: pure black, no frame, swipe sideways for the next one. The close button sits above the stage and `children` below it, so nothing is ever drawn over the photo. `children` are inert while a swipe is under way, so they never act on the photo that is leaving. */
export const FotoTelaCheia = React.forwardRef<HTMLDialogElement, FotoTelaCheiaProps>(
  ({ fotos, indiceInicial, onFechar, onMudar, className, children, ...props }, ref) => {
    const dialogo = React.useRef<HTMLDialogElement>(null);
    React.useImperativeHandle(ref, () => dialogo.current!);
    // Declared before the scroll position below: a closed dialog has no width to scroll by.
    useDialogoModal(dialogo);
    const trilho = React.useRef<HTMLDivElement>(null);
    const assentar = React.useRef<ReturnType<typeof setTimeout>>(undefined);
    const [rolando, setRolando] = React.useState(false);
    React.useEffect(() => () => clearTimeout(assentar.current), []);
    // Scroll events fire all along a swipe; the photo on screen is read once they stop.
    const aoRolar = (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      setRolando(true);
      clearTimeout(assentar.current);
      assentar.current = setTimeout(() => {
        setRolando(false);
        onMudar?.(Math.round(el.scrollLeft / el.clientWidth));
      }, 120);
    };
    // Only a change from outside moves the rail: one that came from the swipe is already on screen,
    // and writing it back would fight a finger still holding the photo halfway.
    React.useLayoutEffect(() => {
      const el = trilho.current;
      if (el && Math.round(el.scrollLeft / el.clientWidth) !== indiceInicial) el.scrollLeft = el.clientWidth * indiceInicial;
    }, [indiceInicial]);
    const tecla = (e: React.KeyboardEvent<HTMLDialogElement>) => {
      const el = trilho.current;
      if (el && e.key === "ArrowRight") el.scrollBy({ left: el.clientWidth, behavior: "smooth" });
      if (el && e.key === "ArrowLeft") el.scrollBy({ left: -el.clientWidth, behavior: "smooth" });
    };
    return (
      // `cancel` is the Escape key; the dialog stays open until the owner unmounts it.
      <dialog
        ref={dialogo}
        aria-label="Foto em tela cheia"
        onCancel={(e) => {
          e.preventDefault();
          onFechar();
        }}
        onKeyDown={tecla}
        className={cn("fixed inset-0 m-0 size-full max-h-none max-w-none flex-col overscroll-contain border-0 bg-palco p-0 open:flex", className)}
        {...props}
      >
        <button
          type="button"
          onClick={onFechar}
          aria-label="Fechar"
          className="mr-3 mt-3 grid size-11 shrink-0 place-items-center self-end rounded-pill text-palco-foreground outline-none focus-visible:ring-4 focus-visible:ring-ring"
        >
          <X className="size-6" />
        </button>
        <div ref={trilho} onScroll={aoRolar} className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none]">
          {fotos.map((f) => (
            <div key={f.id} className="flex h-full w-full shrink-0 snap-center items-center justify-center">
              {f.src ? <img src={f.src} alt={f.descricao ?? ""} loading="lazy" className="max-h-full max-w-full object-contain" /> : <p className="px-8 text-center font-display text-lg text-palco-foreground">{f.descricao}</p>}
            </div>
          ))}
        </div>
        <div inert={rolando}>{children}</div>
      </dialog>
    );
  },
);
FotoTelaCheia.displayName = "FotoTelaCheia";
