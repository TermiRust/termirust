/** A hidden tab reports its size as "100%", which FitAddon reads as 100px; never resize then. */
export function fitIfVisible(fit: { fit: () => void }, container: HTMLElement) {
  if (container.offsetWidth > 0 && container.offsetHeight > 0) fit.fit();
}
