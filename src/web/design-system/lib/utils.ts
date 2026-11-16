import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// tailwind-merge only knows Tailwind's own names. Without these it reads `border-grosso` as a border
// color and `text-logo-sm` as a text color, and drops them when a real color comes after.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["logo-sm", "logo-md", "logo-lg"],
      shadow: ["pop", "pop-sm", "pop-lg", "flutuante", "sticker"],
      radius: ["pill"],
      container: ["coluna"],
    },
    classGroups: {
      "border-w": [{ border: ["grosso"] }],
      "border-w-b": [{ "border-b": ["grosso"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
