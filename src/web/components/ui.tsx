import { ArrowLeft, X } from "lucide-react";
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { BotaoPrincipal, botaoPrincipalVariants, EstadoFotos, type BotaoPrincipalProps } from "../design-system";
import { cn } from "../design-system/lib/utils";
import { formatBytes } from "../format";

const FOCUS_RING = "outline-none focus-visible:ring-4 focus-visible:ring-ring";

const NOTICE_TONE = {
  info: "border-tinta bg-secondary",
  error: "border-destructive bg-card",
  success: "border-sucesso bg-card",
};

export function Notice({ tone, children }: { tone: keyof typeof NOTICE_TONE; children: ReactNode }) {
  return (
    <div
      className={cn("rounded-lg border-grosso px-3 py-2 text-sm font-semibold text-foreground", NOTICE_TONE[tone])}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}

/** A read that failed: the page has nothing else to show in its place. */
export const ErrorNotice = ({ error }: { error: Error }) => (
  <EstadoFotos variant="erro" size="sm" titulo="Ih, deu ruim…">
    {error.message}
  </EstadoFotos>
);

export const ErrorText = ({ message }: { message: string | null }) => (message ? <Notice tone="error">{message}</Notice> : null);

export const Loading = () => <EstadoFotos variant="esperando" size="sm" titulo="Já já a gente acha!" />;

export const Card = ({ className, children }: { className?: string; children: ReactNode }) => (
  <div className={cn("flex flex-col gap-3 rounded-xl border-grosso border-tinta bg-card p-4 text-card-foreground shadow-pop-sm", className)}>
    {children}
  </div>
);

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  backTo?: string;
  children?: ReactNode;
}

export function PageHeader({ title, subtitle, backTo, children }: PageHeaderProps) {
  return (
    <header className="flex items-center gap-3 py-3">
      {backTo && (
        <Link to={backTo} aria-label="Voltar" className={cn("grid size-11 shrink-0 place-items-center rounded-pill border-grosso border-tinta bg-card", FOCUS_RING)}>
          <ArrowLeft className="size-5" />
        </Link>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-2xl font-bold leading-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </header>
  );
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
}

export function Field({ label, hint, className, ...input }: FieldProps) {
  return (
    <label className={cn("flex min-w-0 flex-1 flex-col gap-1 text-sm font-bold", className)}>
      {label}
      <input
        className={cn("h-12 w-full rounded-lg border-grosso border-tinta bg-card px-3 font-body text-base font-normal text-card-foreground", FOCUS_RING)}
        {...input}
      />
      {hint && <span className="font-normal text-muted-foreground">{hint}</span>}
    </label>
  );
}

/** A secondary action: the screen's main one is the large button pinned to the bottom. */
export const SecondaryButton = (props: BotaoPrincipalProps) => <BotaoPrincipal type="button" variant="suave" size="md" {...props} />;

export function TextButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={cn("min-h-11 rounded-md px-2 text-sm font-bold underline disabled:opacity-60", FOCUS_RING, className)} {...props} />;
}

interface FilePickButtonProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  variant?: BotaoPrincipalProps["variant"];
  size?: BotaoPrincipalProps["size"];
}

/** Looks like a button and opens the system file picker: the input is the label's own. */
export function FilePickButton({ variant, size, disabled, children, ...input }: FilePickButtonProps) {
  return (
    <label
      className={cn(
        botaoPrincipalVariants({ variant, size }),
        "cursor-pointer focus-within:ring-4 focus-within:ring-ring",
        disabled && "pointer-events-none bg-muted text-tinta shadow-none",
      )}
    >
      {children}
      <input type="file" className="sr-only" disabled={disabled} {...input} />
    </label>
  );
}

export function Chip({ pressed, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { pressed: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(
        "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-pill border-grosso border-tinta px-4 font-display text-sm font-semibold",
        pressed ? "bg-tinta text-papel" : "bg-card text-card-foreground",
        FOCUS_RING,
        className,
      )}
      {...props}
    />
  );
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const percent = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div
      className="h-3 overflow-hidden rounded-pill border-grosso border-tinta bg-muted"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
    >
      <div className="h-full rounded-pill bg-primary" style={{ width: `${percent}%` }} />
    </div>
  );
}

export function UsageBar({ usedBytes, quotaBytes }: { usedBytes: number; quotaBytes: number }) {
  return (
    <div className="flex flex-col gap-1">
      <ProgressBar value={usedBytes} max={quotaBytes} label="Espaço usado" />
      <span className="text-sm text-muted-foreground">
        {formatBytes(usedBytes)} de {formatBytes(quotaBytes)}
      </span>
    </div>
  );
}

const COPIED_FEEDBACK_MS = 2000;

const COPY_FEEDBACK = { copied: "Link copiado ✨", refused: "Não deu pra copiar" };

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [outcome, setOutcome] = useState<keyof typeof COPY_FEEDBACK | null>(null);
  useEffect(() => {
    if (!outcome) return;
    const timer = setTimeout(() => setOutcome(null), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [outcome]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setOutcome("copied");
    } catch {
      // The browser refuses the clipboard without permission, and has none outside HTTPS.
      setOutcome("refused");
    }
  };
  return <SecondaryButton onClick={() => void copy()}>{outcome ? COPY_FEEDBACK[outcome] : label}</SecondaryButton>;
}

export const inviteUrl = (inviteToken: string) => `${window.location.origin}/j/${inviteToken}`;

interface ConfirmButtonProps {
  label: string;
  confirmLabel: string;
  disabled?: boolean;
  onConfirm: () => void;
}

/** A destructive action in two taps, without leaving the page for a system dialog. */
export function ConfirmButton({ label, confirmLabel, disabled, onConfirm }: ConfirmButtonProps) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <SecondaryButton disabled={disabled} onClick={() => setAsking(true)}>
        {label}
      </SecondaryButton>
    );
  }
  const confirm = () => {
    setAsking(false);
    onConfirm();
  };
  return (
    <span className="flex flex-wrap gap-2">
      <SecondaryButton className="bg-destructive text-destructive-foreground" onClick={confirm}>
        {confirmLabel}
      </SecondaryButton>
      <SecondaryButton onClick={() => setAsking(false)}>Cancelar</SecondaryButton>
    </span>
  );
}

/** A sheet that rises from the bottom of the screen, within thumb reach. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    // `cancel` is the Escape key; `close` is not used because closing on unmount fires it too.
    <dialog
      ref={dialogRef}
      className="mx-auto mb-0 mt-auto w-full max-w-coluna rounded-t-2xl border-grosso border-tinta bg-card p-4 text-card-foreground shadow-flutuante backdrop:bg-palco/60"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold">{title}</h2>
        <button type="button" aria-label="Fechar" className={cn("grid size-11 place-items-center rounded-pill", FOCUS_RING)} onClick={onClose}>
          <X className="size-6" />
        </button>
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </dialog>
  );
}
