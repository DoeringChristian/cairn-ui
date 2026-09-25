import type { ImgHTMLAttributes } from "react";
import { useDecodedSrc } from "../../lib/media/use-settled-frame";

/**
 * An `<img>` that never blanks on a src change: it keeps showing the last
 * decoded image until the new one is decoded, then swaps in one commit (see
 * lib/media/use-settled-frame.ts). Use it wherever a stepped card swaps one
 * image for another.
 */
export default function SettledImg({ src, ...rest }: Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & { src: string }) {
  const settled = useDecodedSrc(src);
  // Before the first decode there is nothing to hold: let the browser load it.
  return <img {...rest} src={settled.src ?? src} decoding={settled.src ? "sync" : "async"} />;
}
